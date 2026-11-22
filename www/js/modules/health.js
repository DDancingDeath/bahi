// -------------------- APP HEALTH (Test in Production, #217) --------------------
// Owner/manager page over the tipHealth counters and tipFailures samples that
// every device reports (tip/index.js), plus the lines for Today's Day report row
// when a check is below its target. Reads are bounded: the page reads the last 14
// days (≤ HEALTH_LIMIT docs) + the latest failures; Today reads today's
// docs at most every 30 minutes.

import { AppState } from '../utils/state.js';
import { UIManager } from '../ui/ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { CHANGED_ELSEWHERE, writeErrorKey } from '../utils/write-conflict.js';
import { t, tn } from '../i18n/index.js';
import { friendlyError } from '../utils/friendly-error.js';
import { emptyState } from '../ui/components.js';
import { tip, tipTargets, tipReasons } from '../tip/index.js';
import { dayKeyOf, normalizePolicies } from '../tip/tip.js';
import {
    aggregateHealth, belowTarget, countedRuns, lastDays, passRate, reasonName, DEFAULT_TARGET
} from '../tip/health-stats.js';

import { attachScrollCue } from '../ui/scroll-cue.js';

const esc = (v) => Helpers.escapeHtml(v == null ? '' : String(v));
const L = (key, params) => esc(t(key, params));
const DAYS = 14;
const SHOW_DAYS = 7;
const HEALTH_LIMIT = 300;
const FAILURE_LIMIT = 30;
const BANNER_TTL_MS = 30 * 60 * 1000;
const BANNER_LIMIT = 50;

const TEST_LABEL_KEYS = {
    AppStart: 'ui.health.test_app_start',
    BillSave: 'ui.health.test_bill_save',
    PaymentRecord: 'ui.health.test_payment_record',
    CashClose: 'ui.health.test_cash_close',
    SessionReads: 'ui.health.test_session_reads',
    Print: 'ui.health.test_print',
    Sync: 'ui.health.test_sync',
    StockCheckpoint: 'ui.health.test_stock_checkpoint',
    NumberChecks: 'ui.health.test_number_checks',
    MainThread: 'ui.health.test_main_thread'
};
const RESULT_LABEL_KEYS = {
    fail: 'ui.health.result_fail',
    abandoned: 'ui.health.result_abandoned',
    expired: 'ui.health.result_expired',
    rolled_back: 'ui.health.result_rolled_back'
};

const canSee = () => AppState.userRole === 'owner' || AppState.userRole === 'manager';
const testLabel = (id) => (TEST_LABEL_KEYS[id] ? t(TEST_LABEL_KEYS[id]) : id);
const prettyReason = (name) => String(name || '').replace(/_/g, ' ');
const dayLabel = (key) => `${key.slice(6, 8)}/${key.slice(4, 6)}`;
const target = (test) => {
    const v = tipTargets()[test];
    return Number.isFinite(v) ? v : DEFAULT_TARGET;
};

/** A pass-rate cell: green at/above target, amber within 5 points, red below. */
function rateCell(n, test) {
    const rate = passRate(n);
    if (rate === null) return '<td class="hl-rate tone-muted">–</td>';
    const goal = target(test);
    const cls = rate >= goal ? 'ok' : rate >= goal - 5 ? 'near' : 'bad';
    return `<td class="hl-rate hl-${cls}" title="${esc(countedRuns(n))}">${esc(rate)}%<small>${esc(countedRuns(n))}</small></td>`;
}

/** The same rate as a labelled chip for the phone-width check rows (U-70). */
function rateChip(n, test, labelKey) {
    const rate = passRate(n);
    const goal = target(test);
    const cls = rate === null ? 'tone-muted' : rate >= goal ? 'hl-ok' : rate >= goal - 5 ? 'hl-near' : 'hl-bad';
    return `<span class="hl-chip ${cls}">${L(labelKey)} <strong>${rate === null ? '–' : `${esc(rate)}%`}</strong></span>`;
}

/** Policy names an owner types in the rules box, said in words on the page (U-50). */
const POLICY_LABEL_KEYS = { billChecksBlocking: 'ui.health.policy_bill_checks' };

const ROLE_LABEL_KEYS = { owner: 'ui.health.role_owner', manager: 'ui.roles.manager', staff: 'ui.roles.member' };

/**
 * Who uses a device (profile name, else role) and a short device tag (F34): `tag` = role (when named) and `code`.
 * @returns {{who: string, tag: string, role: string, code: string}}
 */
export function deviceLabel(dev, usersById = {}) {
    const user = dev?.uid ? usersById[dev.uid] : null;
    const role = user?.role ? t(ROLE_LABEL_KEYS[user.role] || 'ui.roles.member') : '';
    const name = String(user?.name || '').trim();
    const id = String(dev?.deviceId || '');
    const tag = `#${id.slice(-4)}`;
    if (name) return { who: name, tag: role ? `${role} · ${tag}` : tag, role, code: tag };
    return { who: role || t('ui.health.unknown_user'), tag, role: '', code: tag };
}

const PLATFORM_LABEL_KEYS = { android: 'ui.health.platform_android', web: 'ui.health.platform_web' };

/** Device type ('android' / 'web', from tip/report.js) in the app language; unknown values as stored. */
export const platformLabel = (p) => (PLATFORM_LABEL_KEYS[p] ? t(PLATFORM_LABEL_KEYS[p]) : String(p || ''));

function deviceCellHtml(dev, usersById) {
    const { who, role, code } = deviceLabel(dev, usersById);
    // The device id is a code, not words in either language (lang="zxx").
    const codeHtml = `<span lang="zxx" translate="no">${esc(code)}</span>`;
    return `<strong>${esc(who)}</strong><div class="hl-muted" title="${esc(dev.deviceId)}">${role ? `${esc(role)} · ` : ''}${codeHtml}</div>`;
}

export const HealthManager = {
    /** Page data: { docs, failures, at } */
    data: null,
    /** Today's checks cache: { day, docs, at } */
    banner: null,

    openPage() {
        window.app?.nav?.showTab('health');
    },

    async init() {
        const denied = document.getElementById('healthDenied');
        const body = document.getElementById('healthBody');
        if (denied) denied.hidden = canSee();
        if (body) body.hidden = !canSee();
        if (!canSee()) return;
        this.renderPolicyCard();
        if (this.data) this.render();
        if (!this.data || Date.now() - this.data.at > BANNER_TTL_MS) await this.refresh();
    },

    async refresh() {
        if (!canSee()) return;
        const status = document.getElementById('healthStatus');
        if (status) status.textContent = t('ui.health.loading');
        try {
            const today = dayKeyOf(Date.now());
            const [docs, failures, users] = await Promise.all([
                FirebaseService.loadTipHealth({ sinceDay: lastDays(today, DAYS)[DAYS - 1], limit: HEALTH_LIMIT }),
                FirebaseService.loadTipFailures({ limit: FAILURE_LIMIT }).catch(e => {
                    console.warn('TIP failures not loaded:', e?.code || e);
                    return [];
                }),
                FirebaseService.loadPeople().catch(e => {
                    console.warn('Users for device names not loaded:', e?.code || e);
                    return [];
                })
            ]);
            this.data = { docs, failures, users, at: Date.now() };
            this.banner = { day: today, docs: docs.filter(d => d.day === today), at: Date.now() };
            this.render();
        } catch (error) {
            console.warn('App health not loaded:', error?.code || error);
            if (status) status.textContent = t('ui.health.load_failed', { message: friendlyError(error) });
        }
    },

    render() {
        const { docs = [], failures = [], users = [], at } = this.data || {};
        const usersById = Object.fromEntries((users || []).map(u => [u.id, u]));
        const agg = aggregateHealth(docs, { reasonsByTest: tipReasons() });
        const today = dayKeyOf(Date.now());
        const status = document.getElementById('healthStatus');
        if (status) {
            status.textContent = t(docs.length === 1 ? 'ui.health.updated_one' : 'ui.health.updated', {
                time: Helpers.formatTime(at || Date.now()),
                docs: docs.length
            });
        }
        const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        const empty = emptyState({ icon: 'pulse', title: t('ui.health.no_data') });
        if (!agg.tests.length) {
            ['healthSummary', 'healthByDay', 'healthByVersion', 'healthReasons', 'healthDurations', 'healthDevices'].forEach(id => set(id, empty));
            set('healthFailures', this.failuresHtml(failures) || empty);
            return;
        }

        const days7 = lastDays(today, SHOW_DAYS);
        const todayN = (test) => agg.byTestDay[test]?.[today] || {};
        const sumDays = (test, keys) => keys.reduce((acc, d) => {
            Object.entries(agg.byTestDay[test]?.[d] || {}).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; });
            return acc;
        }, {});

        // One row per check, fits a phone (U-70)
        set('healthSummary', `<div class="hl-rows">${agg.tests.map(test => `<div class="row hl-check">
                <div class="row-main"><strong class="row-title">${esc(testLabel(test))}</strong>
                <div class="hl-chips">${rateChip(todayN(test), test, 'ui.health.today')}${rateChip(sumDays(test, days7), test, 'ui.health.last_7_days')}${rateChip(agg.totals[test], test, 'ui.health.last_14_days')}</div>
                <div class="hl-muted">${L('ui.health.check_line', { target: target(test), failing: agg.devicesByTest[test]?.failing || 0, total: agg.devicesByTest[test]?.total || 0 })}</div></div>
            </div>`).join('')}</div>`);

        set('healthByDay', `<table class="table hl-table"><thead><tr><th>${L('ui.health.check')}</th>${days7.map(d => `<th>${esc(dayLabel(d))}</th>`).join('')}</tr></thead>
            <tbody>${agg.tests.map(test => `<tr><th scope="row">${esc(testLabel(test))}</th>${days7.map(d => rateCell(agg.byTestDay[test]?.[d] || {}, test)).join('')}</tr>`).join('')}</tbody></table>`);

        const versions = [...new Set(agg.tests.flatMap(test => Object.keys(agg.byTestVersion[test] || {})))].sort().reverse();
        set('healthByVersion', `<table class="table hl-table"><thead><tr><th>${L('ui.health.check')}</th>${versions.map(v => `<th>${esc(v.replace(/_/g, '.'))}</th>`).join('')}</tr></thead>
            <tbody>${agg.tests.map(test => `<tr><th scope="row">${esc(testLabel(test))}</th>${versions.map(v => rateCell(agg.byTestVersion[test]?.[v] || {}, test)).join('')}</tr>`).join('')}</tbody></table>`);

        set('healthReasons', agg.reasons.length ? `<ol class="hl-list">${agg.reasons.slice(0, 10).map(r =>
            `<li><strong>${esc(testLabel(r.test))}</strong>: ${esc(prettyReason(r.name))} <span class="tone-muted">× ${esc(r.count)}</span></li>`).join('')}</ol>`
            : emptyState({ icon: 'check', tone: 'pos', title: t('ui.health.no_failures') }));

        set('healthDurations', `<table class="table hl-table"><thead><tr><th>${L('ui.health.check')}</th><th>${L('ui.health.p50')}</th><th>${L('ui.health.p90')}</th></tr></thead>
            <tbody>${agg.tests.map(test => {
                const d = agg.durations[test] || {};
                const fmt = (ms) => (ms == null ? '–' : `≤ ${ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`}`);
                return `<tr><th scope="row">${esc(testLabel(test))}</th><td>${esc(fmt(d.p50))}</td><td>${esc(fmt(d.p90))}</td></tr>`;
            }).join('')}</tbody></table>`);

        set('healthDevices', `<div class="hl-rows">${agg.devices.slice(0, 30).map(dev => `<div class="row hl-device${dev.failed ? ' tone-neg' : ''}">
                <div class="row-main">${deviceCellHtml(dev, usersById)}
                <div class="hl-muted">${L('ui.health.device_line', { platform: platformLabel(dev.platform), version: dev.appVersion || '', day: dev.lastDay ? dayLabel(dev.lastDay) : '–', runs: dev.runs || 0, failed: dev.failed || 0 })}</div></div>
            </div>`).join('')}</div>`);

        set('healthFailures', this.failuresHtml(failures) || emptyState({ icon: 'check', tone: 'pos', title: t('ui.health.no_failures') }));
        document.querySelectorAll('#health .scroll-cue-inner').forEach(attachScrollCue);
    },

    failuresHtml(failures) {
        if (!failures || !failures.length) return '';
        const reasons = tipReasons();
        return `<div class="panel hl-failures">${failures.map(f => {
            const when = Number(f.at) ? Helpers.formatDateTime(Number(f.at)) : '';
            const resultKey = RESULT_LABEL_KEYS[f.result];
            const flags = Object.entries(f.flags || {}).map(([k, v]) => `${k}=${v}`).join(', ');
            return `<div class="row hl-failure">
                <div class="row-main">
                    <div class="hl-failure-head"><strong>${esc(testLabel(f.test))}</strong> <span class="tag neg">${esc(resultKey ? t(resultKey) : f.result)}</span> ${esc(prettyReason(f.reasonName || reasonName(f.test, f.reason, reasons)))}</div>
                    <div class="hl-muted">${esc(when)} · ${esc(f.appVersion)} · ${esc(platformLabel(f.platform))} · <span lang="zxx" translate="no" title="${esc(f.deviceId)}">#${esc(String(f.deviceId || '').slice(-4))}</span>${flags ? ` · ${esc(flags)}` : ''}</div>
                </div>
            </div>`;
        }).join('')}</div>`;
    },

    /** Owner: edit settings/app.tipPolicies; everyone who sees the page: this device's policy state. */
    renderPolicyCard() {
        const card = document.getElementById('healthPolicyCard');
        if (!card) return;
        card.hidden = false;
        const policies = tip.getPolicies();
        const textarea = document.getElementById('healthPolicies');
        if (textarea) {
            textarea.value = JSON.stringify(Object.keys(policies).length ? policies : {
                billChecksBlocking: { test: 'BillSave', reason: 'blocked_valid_bill', passrate: 25, count: 5, telemetryOnly: true }
            }, null, 2);
            textarea.readOnly = AppState.userRole !== 'owner';
        }
        const saveBtn = card.querySelector('button');
        if (saveBtn) saveBtn.hidden = AppState.userRole !== 'owner';
        const state = document.getElementById('healthPolicyState');
        if (state) {
            const rows = Object.entries(policies).map(([key, p]) => {
                const s = tip.policyState(key);
                const mode = p.telemetryOnly ? t('ui.health.report_only') : t('ui.health.switches_safe_mode');
                const now = s.tripped ? t('ui.health.policy_tripped', { rate: s.passrate }) : tn('ui.health.policy_ok', s.runs, { runs: s.runs });
                return `<li><strong>${POLICY_LABEL_KEYS[key] ? L(POLICY_LABEL_KEYS[key]) : esc(key)}</strong> (${esc(testLabel(p.test))}, ${esc(mode)}): ${esc(now)}</li>`;
            });
            state.innerHTML = rows.length ? `<ul class="hl-list">${rows.join('')}</ul>` : `<div class="hl-muted">${L('ui.health.no_policies')}</div>`;
        }
    },

    async savePolicies() {
        if (AppState.userRole !== 'owner') return;
        let parsed;
        try {
            parsed = JSON.parse(document.getElementById('healthPolicies')?.value || '{}');
        } catch (_) {
            UIManager.showToast(t('msg.health.policies_invalid'));
            return;
        }
        const policies = normalizePolicies(parsed);
        try {
            await FirebaseService.saveTipPolicies(policies);
            tip.setPolicies(policies);
            this.renderPolicyCard();
            UIManager.showToast(t('msg.health.policies_saved', { count: Object.keys(policies).length }));
        } catch (error) {
            const key = writeErrorKey(error, null);
            UIManager.showToast(key ? t(key) : t('msg.health.policies_not_saved', { message: friendlyError(error) }));
            if (error?.code === CHANGED_ELSEWHERE) {
                // Show the policies stored now (another phone's), not this stale form
                try {
                    tip.setPolicies((await FirebaseService.loadAppSettings())?.tipPolicies || {});
                    this.renderPolicyCard();
                } catch (e) {
                    console.warn('TIP policies not read again:', e);
                }
            }
        }
    },

    /**
     * Today (owner/manager): one line per check below target today, shown in the Day report row
     * (NEW-06). Reads today's docs at most every 30 minutes; never throws.
     * @returns {Promise<string[]>}
     */
    async todayAlerts() {
        if (!canSee()) return [];
        try {
            const today = dayKeyOf(Date.now());
            if (!this.banner || this.banner.day !== today || Date.now() - this.banner.at > BANNER_TTL_MS) {
                // Today redraws on every data change: one query at a time
                if (!this.bannerLoading) {
                    this.bannerLoading = FirebaseService.loadTipHealth({ sinceDay: today, untilDay: today, limit: BANNER_LIMIT })
                        .then(docs => { this.banner = { day: today, docs, at: Date.now() }; })
                        .finally(() => { this.bannerLoading = null; });
                }
                await this.bannerLoading;
            }
            return belowTarget(this.banner.docs, { day: today, targets: tipTargets() }).map(x => t('ui.health.banner_line', {
                check: testLabel(x.test), rate: x.rate, target: x.target, runs: x.runs
            }));
        } catch (error) {
            console.warn('App health checks not loaded:', error?.code || error);
            return [];
        }
    }
};
