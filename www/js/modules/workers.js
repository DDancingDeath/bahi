/**
 * @fileoverview Workers / Salaries (#373 phase 1): the owner's monthly pay tracker. Each worker's
 * month is paid, part-paid or due, with payments and advances and the balance carried to the next
 * month (docs/calculations.md WP-1 … WP-12). Imported on first open; one read per worker per open.
 * Each pay or advance counts in Money and Today through its one expense, saved with it (WP-12).
 * @module modules/workers
 */

import { UIManager } from '../ui/ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { AppState } from '../utils/state.js';
import { t, getLang } from '../i18n/index.js';
import { emptyState, skeleton } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { formatRupees, moneyText } from '../utils/money.js';
import { formatMonth, formatDay, todayLocalISO } from '../utils/dates.js';
import * as repo from '../firebase/repos/workers.js';
import {
    MAX_NAME, MAX_NOTE, MAX_PAY_STEPS, leftFrom, lastPay, monthKeyOf, addMonthKey, payFor, withPay, withStart,
    paySummary, balanceParts, checkEntry, checkWorker, isMonthKey, payDueMonths
} from '../utils/worker-pay.js';
import { savePayDue } from '../utils/pay-reminder.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { askReason } from '../ui/bill-status.js';
import { infoTipHtml } from '../ui/info-tip.js';
import { validateExpenseEntry } from '../utils/expense-entry.js';
import { salaryExpense, linkCandidates, payExpenseId, payFromExpense, expenseDayOf } from '../utils/linked-expense.js';
import { isPermissionDenied } from '../utils/record-permissions.js';
import { ageInDays, dueTone } from '../utils/aging.js';

const esc = (v) => Helpers.escapeHtml(v == null ? '' : String(v));
const js = (v) => Helpers.escapeJsAttr(v);
const et = (key, p) => esc(t(key, p));
const byId = (id) => document.getElementById(id);
const val = (id) => (byId(id)?.value ?? '').trim();
const monthText = (key) => esc(formatMonth(`${key}-01`, { lang: getLang() }));
const thisMonth = () => monthKeyOf(new Date());
const isOwner = () => AppState.userRole === 'owner';
const isShown = () => byId('workers')?.classList.contains('active');
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const state = {
    workers: [],
    loaded: false,
    error: false,
    month: null,
    open: '',
    form: '',
    seq: 0,
    rejoining: false,
    /** The pay form's choices: mode '' until picked (never a silent cash), in 'new' | 'have', the picked expense. */
    pay: { mode: '', inExp: 'new', expenseId: '', amount: '', kind: 'pay', month: '', date: '', note: '' }
};

const STATE_TAGS = { paid: 'pos' };

/** Days since a month's pay fell due (the 1st of the next month); 0 until then. */
function monthAgeDays(month) {
    if (!isMonthKey(month)) return null;
    return ageInDays(new Date(`${addMonthKey(month, 1)}-01T00:00:00`));
}

function stateTag(row) {
    if (!row?.state) return '';
    const text = row.state === 'part'
        ? t('ui.workers.state_part', { paid: formatRupees(row.covered), of: formatRupees(row.owed) })
        : row.state === 'due' ? t('ui.workers.state_due', { amount: formatRupees(row.owed) }) : t('ui.workers.state_paid');
    const left = row.state === 'part' ? Number(row.owed) - Number(row.covered) : Number(row.owed);
    const tone = STATE_TAGS[row.state] || dueTone(monthAgeDays(row.month || state.month), left);
    return `<span class="tag${tone ? ` ${esc(tone)}` : ''}" data-wp-state="${esc(row.state)}">${esc(text)}</span>`;
}

function balanceLine(balance) {
    const { left, advance } = balanceParts(balance);
    if (left > 0) return `<span class="wp-left">${et('ui.workers.balance_left', { amount: formatRupees(left) })}</span>`;
    if (advance > 0) return `<span class="tone-info">${et('ui.workers.advance_carried', { amount: formatRupees(advance) })}</span>`;
    return `<span class="tone-muted">${et('ui.workers.nothing_left')}</span>`;
}

function metric(id, key, amount) {
    return `<div class="metric"><div class="metric-label">${et(key)}</div><div class="metric-value" data-wp="${esc(id)}">${moneyText(amount)}</div></div>`;
}

function renderSummary(sum) {
    const latest = state.month >= thisMonth();
    return `<div class="wp-month">
            <button type="button" class="btn btn-icon" data-onclick="workers.step(-1)" aria-label="${et('ui.workers.prev_month')}">${icon('chevL')}</button>
            <b id="workersMonth">${monthText(state.month)}</b>
            <button type="button" class="btn btn-icon" data-onclick="workers.step(1)" aria-label="${et('ui.workers.next_month')}"${latest ? ' disabled' : ''}>${icon('chevR')}</button>
        </div>
        <div class="panel metrics wp-metrics">
            ${metric('WP-7', 'ui.workers.pay_month', sum.pay)}
            ${metric('WP-8', 'ui.workers.paid_out_month', sum.paidOut)}
            ${metric('WP-9', 'ui.workers.to_pay', sum.toPay)}
            ${metric('WP-10', 'ui.workers.advances', sum.advances)}
        </div>
        <div class="wp-actions wp-list-head">
            <p class="tone-muted wp-counts">${et('ui.workers.counts', sum.counts)}</p>
            <button type="button" class="btn btn-tonal wp-add" data-onclick="workers.showForm('add')">${icon('plus', 'i-sm')} ${et('ui.workers.add')}</button>
        </div>`;
}

function renderRow({ worker, row, balance }) {
    const pay = payFor(worker, state.month);
    const meta = worker.active === false ? t('ui.workers.left') : t('ui.workers.pay_a_month', { amount: formatRupees(pay) });
    const open = state.open === worker.id;
    return `<button type="button" class="row${open ? ' selected' : ''}" data-worker="${esc(worker.id)}" aria-expanded="${open}" data-onclick="workers.open('${js(worker.id)}')">
            <span class="row-main"><span class="row-title">${esc(worker.name)}</span><span class="row-meta">${esc(meta)}</span></span>
            <span class="row-trail">${stateTag(row)}<span class="row-meta">${balanceLine(balance)}</span></span>
        </button>`;
}

const label = (id, key) => `<label for="${esc(id)}">${et(key)}</label>`;

const KIND_KEYS = { pay: 'ui.workers.kind_pay', advance: 'ui.workers.kind_advance' };
const MODE_KEYS = { cash: 'ui.workers.mode_cash', online: 'ui.workers.mode_online' };
const options = (keys, chosen) => Object.entries(keys).map(([v, key]) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${et(key)}</option>`).join('');

function formActions(save) {
    return `<div class="wp-actions">
            <button type="button" class="btn btn-primary" id="wpSave" data-onclick="workers.${esc(save)}()">${et('ui.workers.save')}</button>
            <button type="button" class="btn btn-ghost" data-onclick="workers.cancel()">${et('ui.modals.cancel')}</button>
        </div>`;
}

function renderAddForm() {
    return `<div class="panel panel-pad wp-form" id="wpAddForm">
            <h3>${et('ui.workers.add')}</h3>
            <div class="field">${label('wpName', 'ui.workers.name')}<input class="input" id="wpName" maxlength="${esc(MAX_NAME)}" autocomplete="off"></div>
            <div class="field">${label('wpPay', 'ui.workers.monthly_pay')}<div class="adorn"><span class="adorn-pre" aria-hidden="true">₹</span><input class="input" id="wpPay" inputmode="numeric" type="number" min="1" step="1"></div></div>
            <div class="field">${label('wpStart', 'ui.workers.start_month')}<input class="input" id="wpStart" type="month" value="${esc(thisMonth())}"></div>
            ${formActions('saveWorker')}
        </div>`;
}

const seg = (key, field, pairs, chosen) => `<div class="field"><span class="wp-pick-label" id="wp-${esc(field)}-l">${et(key)}</span>
            <div class="seg" role="group" aria-labelledby="wp-${esc(field)}-l" data-wp-seg="${esc(field)}">${pairs.map(([v, k]) => `<button type="button" aria-pressed="${String(v === chosen)}" data-onclick="workers.pick('${js(field)}', '${js(v)}')">${et(k)}</button>`).join('')}</div></div>`;

/** "Already entered in Expenses": the expenses near the entry's day, the same amount first. */
function expenseChoices(p) {
    const list = linkCandidates(AppState.expensesHistory || [], { day: p.date || todayLocalISO(), amount: Number(p.amount) || 0 }).slice(0, 12);
    if (!list.length) return `<p class="tone-muted" id="wpNoExpense">${et('ui.workers.no_expense_match')}</p>`;
    return `<div class="panel wp-exp-list" role="radiogroup" aria-label="${et('ui.workers.pick_expense')}">${list.map(x => `<label class="row">
            <input type="radio" name="wpExpense" value="${esc(x.id)}"${String(x.id) === p.expenseId ? ' checked' : ''} data-onchange="workers.pick('expenseId', '${js(x.id)}')">
            <span class="row-main"><span class="row-title">${esc(formatRupees(x.amount))} · ${esc(x.personName || x.type || '')}</span>
            <span class="row-meta">${esc(formatDay(expenseDayOf(x), { lang: getLang() }))} · ${et(MODE_KEYS[x.paymentMode === 'online' ? 'online' : 'cash'])}${x.remarks ? ` · ${esc(x.remarks)}` : ''}</span></span></label>`).join('')}</div>`;
}

function renderPayForm(worker) {
    const p = state.pay;
    const have = p.inExp === 'have';
    return `<div class="panel panel-pad wp-form" id="wpPayForm">
            <h3>${et('ui.workers.record', { name: worker.name })}</h3>
            <div class="field">${label('wpAmount', 'ui.workers.amount')}<div class="adorn"><span class="adorn-pre" aria-hidden="true">₹</span><input class="input" id="wpAmount" inputmode="numeric" type="number" min="1" step="1" value="${esc(p.amount)}" data-onchange="workers.keep()"></div></div>
            <div class="field">${label('wpKind', 'ui.workers.kind')}<select class="input" id="wpKind">${options(KIND_KEYS, p.kind)}</select></div>
            <div class="field">${label('wpForMonth', 'ui.workers.for_month')}<input class="input" id="wpForMonth" type="month" value="${esc(p.month || state.month)}" max="${esc(thisMonth())}"></div>
            <div class="field">${label('wpDate', 'ui.workers.date')}<input class="input" id="wpDate" type="date" value="${esc(p.date || todayLocalISO())}" max="${esc(todayLocalISO())}" data-onchange="workers.keep()"></div>
            ${seg('ui.workers.in_expenses', 'inExp', [['new', 'ui.workers.add_to_expenses'], ['have', 'ui.workers.already_in_expenses']], p.inExp)}
            ${have ? expenseChoices(p) : seg('ui.workers.mode', 'mode', Object.entries(MODE_KEYS), p.mode)}
            <div class="field">${label('wpNote', 'ui.workers.note')}<input class="input" id="wpNote" maxlength="${esc(MAX_NOTE)}" autocomplete="off" value="${esc(p.note)}"></div>
            <p class="tone-muted wp-hint">${et('ui.workers.counts_once')} ${infoTipHtml(t(have ? 'ui.workers.counts_once_have' : 'ui.workers.counts_once_new'))}</p>
            ${formActions('savePay')}
        </div>`;
}

function renderEditForm(worker) {
    const pay = payFor(worker, thisMonth());
    const hidePay = worker.active === false && !state.rejoining;
    const stop = hidePay ? leftFrom(worker.pays) : null;
    const startMax = stop ? `max="${esc(addMonthKey(stop, -1))}"` : '';
    const payFields = hidePay ? '' : `<div class="field">${label('wpPay', 'ui.workers.monthly_pay')}<div class="adorn"><span class="adorn-pre" aria-hidden="true">₹</span><input class="input" id="wpPay" inputmode="numeric" type="number" min="1" step="1" value="${esc(pay || '')}"></div></div>
            <div class="field">${label('wpPayFrom', 'ui.workers.pay_from')}<input class="input" id="wpPayFrom" type="month" value="${esc(thisMonth())}"></div>
            <p class="tone-muted">${et('ui.workers.pay_from_help')}</p>`;
    return `<div class="panel panel-pad wp-form" id="wpEditForm">
            <h3>${et('ui.workers.edit')}</h3>
            <div class="field">${label('wpName', 'ui.workers.name')}<input class="input" id="wpName" maxlength="${esc(MAX_NAME)}" value="${esc(worker.name)}" autocomplete="off"></div>
            <div class="field">${label('wpStart', 'ui.workers.start_month')}<input class="input" id="wpStart" type="month" value="${esc(worker.startMonth)}" ${startMax}></div>
            ${payFields}
            ${formActions('saveEdit')}
        </div>`;
}

function renderLeftForm() {
    return `<div class="panel panel-pad wp-form" id="wpLeftForm">
            <h3>${et('ui.workers.mark_left')}</h3>
            <div class="field">${label('wpLastMonth', 'ui.workers.last_month')}<input class="input" id="wpLastMonth" type="month" value="${esc(thisMonth())}"></div>
            <p class="tone-muted">${et('ui.workers.left_help')}</p>
            ${formActions('saveLeft')}
        </div>`;
}

function renderMonths(months) {
    const shown = months.filter(r => r.state || r.paid > 0).slice(-24).reverse();
    if (!shown.length) return '';
    const rows = shown.map(r => `<tr data-month="${esc(r.month)}">
            <td>${monthText(r.month)}</td>
            <td class="num">${moneyText(r.pay)}</td>
            <td class="num">${moneyText(r.paid)}</td>
            <td class="num">${r.recovered > 0 ? et('ui.workers.from_advance', { amount: formatRupees(r.recovered) }) : ''}</td>
            <td>${stateTag(r)}</td>
            <td>${balanceLine(r.closing)}</td>
        </tr>`).join('');
    return `<div class="scroll-cue"><div class="scroll-cue-inner"><table class="table">
            <thead><tr><th>${et('ui.workers.month')}</th><th>${et('ui.workers.col_pay')}</th><th>${et('ui.workers.col_paid')}</th><th>${et('ui.workers.col_advance')}</th><th>${et('ui.workers.col_state')}</th><th>${et('ui.workers.col_balance')}</th></tr></thead>
            <tbody>${rows}</tbody></table></div></div>`;
}

function renderEntries(worker) {
    const list = [...(worker.entries || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.month).localeCompare(String(a.month)));
    if (!list.length) return emptyState({ icon: 'list', title: t('ui.workers.no_entries') });
    return list.map(e => {
        const inMoney = !!payExpenseId(worker, e);
        const mark = inMoney ? '' : ` <span class="tag warn" data-wp-not-in-money>${et('ui.workers.not_in_money')}</span>`;
        const add = inMoney ? '' : `<button type="button" class="btn btn-tonal btn-sm" data-onclick="workers.addToMoney('${js(worker.id)}', '${js(e.id)}')">${et('ui.workers.add_to_money')}</button>`;
        return `<div class="row" data-entry="${esc(e.id)}">
            <span class="row-main"><span class="row-title">${moneyText(e.amount)} · ${et(KIND_KEYS[e.kind] || KIND_KEYS.pay)}${mark}</span>
            <span class="row-meta">${et('ui.workers.entry_meta', { month: formatMonth(`${e.month}-01`, { lang: getLang() }), date: formatDay(e.date, { lang: getLang() }), mode: t(MODE_KEYS[e.mode] || MODE_KEYS.cash) })}${e.note ? ` · ${esc(e.note)}` : ''}</span></span>
            ${add}<button type="button" class="btn btn-ghost btn-sm" data-onclick="workers.removeEntry('${js(worker.id)}', '${js(e.id)}')">${et(inMoney ? 'ui.workers.void' : 'ui.workers.remove')}</button>
        </div>`;
    }).join('');
}

function renderDetail(item) {
    const w = item.worker;
    const form = state.form === 'pay' ? renderPayForm(w) : state.form === 'edit' ? renderEditForm(w) : state.form === 'left' ? renderLeftForm() : '';
    const leave = w.active === false
        ? `<button type="button" class="btn btn-tonal btn-sm" data-onclick="workers.rejoin()">${et('ui.workers.rejoin')}</button>`
        : `<button type="button" class="btn btn-tonal btn-sm" data-onclick="workers.showForm('left')">${et('ui.workers.mark_left')}</button>`;
    return `<section class="panel panel-pad wp-detail" id="wpDetail">
            <h3>${esc(w.name)}</h3>
            <p>${balanceLine(item.balance)}</p>
            <div class="wp-actions">
                <button type="button" class="btn btn-tonal btn-sm" data-onclick="workers.showForm('pay')">${et('ui.workers.record_btn')}</button>
                <button type="button" class="btn btn-tonal btn-sm" data-onclick="workers.showForm('edit')">${et('ui.workers.edit')}</button>
                ${leave}
            </div>
            ${form}
            <h4>${et('ui.workers.by_month')}</h4>
            ${renderMonths(item.months)}
            <h4>${et('ui.workers.entries')}</h4>
            <div class="panel">${renderEntries(w)}</div>
        </section>`;
}

export function render() {
    const root = byId('workersBody');
    if (!root) return;
    if (!isOwner()) {
        root.innerHTML = `<p class="empty">${et('ui.workers.owner_only')}</p>`;
        return;
    }
    if (!state.loaded) {
        root.innerHTML = state.error
            ? `<p class="notice neg">${et('msg.workers.not_loaded')}</p>`
            : skeleton({ label: t('ui.workers.loading') });
        return;
    }
    const sum = paySummary(state.workers, state.month);
    const items = [...sum.rows].sort((a, b) => (a.worker.active === false) - (b.worker.active === false) || a.worker.name.localeCompare(b.worker.name));
    const open = items.find(i => i.worker.id === state.open);
    const list = items.length
        ? `<div class="panel wp-list">${items.map(renderRow).join('')}</div>`
        : emptyState({ icon: 'users', title: t('ui.workers.none') });
    root.innerHTML = `${renderSummary(sum)}
        ${state.form === 'add' ? renderAddForm() : ''}
        ${list}
        ${open ? renderDetail(open) : ''}`;
}

function ensureCss() {
    if (byId('workersCss')) return;
    const link = document.createElement('link');
    link.id = 'workersCss';
    link.rel = 'stylesheet';
    link.href = 'css/workers.css';
    document.head.appendChild(link);
}

/** Keeps WP-11 for Today from the loaded workers (no reads). */
function noteDue(list = state.workers, uid = AppState.currentUser?.uid) {
    if (!uid) return;
    try { savePayDue(localStorage, { uid, months: payDueMonths(list, thisMonth()) }); } catch (_) { /* never break the page */ }
}

/**
 * Today's salaries line (WP-11), once a day on the owner's phone (main.js, after the first screen):
 * one read per worker. Nothing on the page changes.
 */
export async function refreshPayDue() {
    const uid = AppState.currentUser?.uid;
    if (!isOwner() || !uid) return false;
    const seq = state.seq;
    const list = await repo.loadWorkers();
    if (AppState.currentUser?.uid !== uid || !isOwner()) return false;
    // The page opened or saved meanwhile: its figure is newer than this read
    if (seq !== state.seq || state.loaded) return false;
    noteDue(list, uid);
    return true;
}

/** Opens the page: reads every worker once (one read each). */
export async function init() {
    ensureCss();
    if (!state.month) state.month = thisMonth();
    state.loaded = false;
    state.error = false;
    render();
    if (!isOwner()) return;
    const seq = ++state.seq;
    try {
        const list = await repo.loadWorkers();
        if (seq !== state.seq) return;
        state.workers = list;
        state.loaded = true;
        noteDue();
    } catch (e) {
        console.warn('Workers not loaded:', e?.code || e);
        if (seq === state.seq) state.error = true;
    }
    if (isShown()) render();
}

export function step(n) {
    const next = addMonthKey(state.month || thisMonth(), n);
    if (next > thisMonth()) return;
    state.month = next;
    render();
}

export function open(id) {
    state.open = state.open === id ? '' : id;
    if (state.form !== 'add') state.form = '';
    state.rejoining = false;
    render();
    if (state.open) byId('wpDetail')?.scrollIntoView?.({ block: 'nearest' });
}

export function showForm(kind, rejoining = false) {
    state.form = kind;
    state.rejoining = rejoining;
    if (kind === 'pay') state.pay = { mode: '', inExp: 'new', expenseId: '', amount: '', kind: 'pay', month: '', date: '', note: '' };
    render();
    byId(kind === 'pay' ? 'wpAmount' : kind === 'left' ? 'wpLastMonth' : 'wpName')?.focus?.();
}

export function cancel() {
    state.form = '';
    state.rejoining = false;
    render();
}

const openWorker = () => state.workers.find(w => w.id === state.open);

/** Runs one save (one tap = one write), refusing offline; true when saved. */
async function save(key, fn, doneKey, params) {
    if (Helpers.isBusy(key)) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        UIManager.showToast(t('msg.workers.needs_internet'), 'warning');
        return false;
    }
    try {
        await Helpers.runExclusive(key, '#workers .btn', fn);
        noteDue();
        state.form = '';
        state.rejoining = false;
        render();
        UIManager.showToast(t(doneKey, params), 'success');
        return true;
    } catch (e) {
        console.warn('Worker pay not saved:', e?.code || e);
        UIManager.showToast(t('msg.workers.not_saved'), 'error');
        return false;
    }
}

const warn = (key, params) => UIManager.showToast(t(key, params), 'warning');

/** Keeps what is typed in the pay form across a redraw. */
export function keep() {
    if (!byId('wpPayForm')) return;
    Object.assign(state.pay, { amount: val('wpAmount'), kind: val('wpKind') || 'pay', month: val('wpForMonth'), date: val('wpDate'), note: val('wpNote') });
}

/** The pay form's buttons: cash / online, add / already in Expenses, the expense picked. */
export function pick(field, value) {
    keep();
    if (!['mode', 'inExp', 'expenseId'].includes(field)) return;
    state.pay[field] = String(value);
    if (field !== 'expenseId') render();
}

/** Drawer and Today follow a new or voided salary expense at once. */
function refreshCash() {
    const cm = window.app?.cashManagement;
    if (!cm) return;
    cm.calculateTodayTransactions?.().catch?.(e => console.warn('Cash refresh after worker pay failed:', e?.code || e));
    cm.updateUI?.();
}

const expenseFor = (w, e) => salaryExpense(w, e, { uid: AppState.currentUser?.uid, name: AppState.userName || '', kindText: e.kind === 'advance' ? t(KIND_KEYS.advance) : '' });

export async function saveWorker() {
    const { worker, error } = checkWorker({ name: val('wpName'), pay: val('wpPay'), startMonth: val('wpStart') }, thisMonth());
    if (error) return warn(error);
    await save('workers.add', async () => {
        const id = await repo.addWorker(worker);
        state.workers.push({ id, name: worker.name, startMonth: worker.startMonth, active: true, pays: [{ from: worker.startMonth, amount: worker.pay }], entries: [] });
        state.open = id;
    }, 'msg.workers.added', { name: worker.name });
}

/**
 * Records a pay or advance with its one expense (WP-12), in one batch: a new expense (business,
 * "Salaries", the entry's mode and day), or one already in Expenses (its amount, day and mode). Online only.
 */
export async function savePay() {
    const w = openWorker();
    if (!w) return;
    keep();
    const p = state.pay;
    const picked = p.inExp === 'have' ? linkCandidates(AppState.expensesHistory || [], { day: p.date || todayLocalISO(), amount: Number(p.amount) || 0 }).find(x => String(x.id) === p.expenseId) : null;
    if (p.inExp === 'have' && !picked) return warn('msg.workers.pick_expense');
    if (p.inExp !== 'have' && !p.mode) return warn('msg.workers.choose_mode');
    const from = picked ? payFromExpense(picked) : { amount: p.amount, date: p.date, mode: p.mode };
    const { entry, error } = checkEntry({ amount: from.amount, month: p.month, date: from.date, kind: p.kind, mode: from.mode, note: p.note }, thisMonth());
    if (error) return warn(error);
    if (!picked) {
        const problem = validateExpenseEntry({ day: entry.date, mode: entry.mode }, { role: AppState.userRole, roleAccess: AppState.settings?.roleAccess, now: new Date() });
        if (problem) return warn(problem.key, problem.params);
    }
    const full = { id: newId(), ...entry };
    const ok = await save('workers.pay', async () => {
        if (picked) {
            await FirebaseService.linkExpense(picked.id, { workerId: w.id, workerPayId: full.id }, repo.payWrite(w.id, full));
            full.expenseId = String(picked.id);
        } else {
            const { record, committed } = FirebaseService.startSaveExpense(expenseFor(w, full), { withBatch: repo.payWrite(w.id, full) });
            await committed;
            full.expenseId = record.id;
        }
        w.entries = [...(w.entries || []), full];
    }, 'msg.workers.recorded', { amount: formatRupees(full.amount), name: w.name });
    if (ok) refreshCash();
}

/** Puts an entry recorded before entries made expenses into Money (one new expense). */
export async function addToMoney(workerId, entryId) {
    const w = state.workers.find(x => x.id === workerId);
    const e = w?.entries?.find(x => x.id === entryId);
    if (!e || !isOwner() || payExpenseId(w, e)) return;
    const ok = await save('workers.money', async () => {
        const { record, committed } = FirebaseService.startSaveExpense(expenseFor(w, e), { withBatch: repo.linkedWrite(w.id, e.id) });
        await committed;
        w.linked = { ...(w.linked || {}), [e.id]: record.id };
    }, 'msg.workers.added_to_money', { amount: formatRupees(e.amount) });
    if (ok) refreshCash();
}

export async function saveEdit() {
    const w = openWorker();
    if (!w) return;
    const rejoining = state.rejoining && w.active === false;
    const left = w.active === false && !rejoining;
    const { worker, error } = checkWorker({ name: val('wpName'), pay: left ? '1' : val('wpPay'), startMonth: val('wpStart') }, thisMonth());
    if (error) return warn(error);
    const stop = leftFrom(w.pays);
    if (left && stop && worker.startMonth >= stop) return warn('msg.workers.start_after_left');
    const from = left ? worker.startMonth : val('wpPayFrom');
    if (!isMonthKey(from)) return warn('msg.workers.bad_month');
    const started = withStart(w.pays, worker.startMonth);
    const pays = left || (!rejoining && payFor({ ...w, startMonth: worker.startMonth, pays: started }, from) === worker.pay) ? started : withPay(started, worker.startMonth, from, worker.pay);
    if (pays.length > MAX_PAY_STEPS) return warn('msg.workers.too_many_pays');
    const patch = { name: worker.name, startMonth: worker.startMonth, pays, ...(rejoining ? { active: true } : {}) };
    await save('workers.edit', async () => {
        await repo.updateWorker(w.id, patch);
        Object.assign(w, patch);
    }, 'msg.workers.saved');
}

export async function saveLeft() {
    const w = openWorker();
    const last = val('wpLastMonth');
    if (!w) return;
    if (!isMonthKey(last) || last < w.startMonth) return warn('msg.workers.bad_month');
    const patch = { active: false, pays: withPay(w.pays, w.startMonth, addMonthKey(last, 1), 0) };
    if (patch.pays.length > MAX_PAY_STEPS) return warn('msg.workers.too_many_pays');
    await save('workers.left', async () => {
        await repo.updateWorker(w.id, patch);
        Object.assign(w, patch);
    }, 'msg.workers.marked_left', { name: w.name });
}

/** Working again at the newest pay from this month; with no earlier pay, the edit form asks for one. */
export async function rejoin() {
    const w = openWorker();
    if (!w) return;
    const amount = lastPay(w.pays);
    if (!amount) {
        state.rejoining = true;
        return showForm('edit', true);
    }
    const patch = { active: true, pays: withPay(w.pays, w.startMonth, thisMonth(), amount) };
    if (patch.pays.length > MAX_PAY_STEPS) return warn('msg.workers.too_many_pays');
    await save('workers.rejoin', async () => {
        await repo.updateWorker(w.id, patch);
        Object.assign(w, patch);
    }, 'msg.workers.rejoined', { name: w.name, amount: formatRupees(amount) });
}

/** Takes an entry off: one in Money by voiding its expense (the entry goes with it, VOID-EXP); an older one as before. */
export async function removeEntry(workerId, entryId) {
    const w = state.workers.find(x => x.id === workerId);
    const entry = w?.entries?.find(e => e.id === entryId);
    if (!entry || Helpers.isBusy('workers.remove')) return;
    const expenseId = payExpenseId(w, entry);
    if (expenseId) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return warn('msg.workers.needs_internet');
        const reason = await askReason({ titleKey: 'ui.workers.void_title', explainKey: 'ui.workers.void_explain', labelKey: 'ui.expenses.void_reason', confirmKey: 'ui.workers.void', danger: true });
        if (!reason) return;
        try {
            await Helpers.runExclusive('workers.remove', '#workers .btn', () => FirebaseService.voidExpense(expenseId, reason));
        } catch (e) {
            console.warn('Worker pay not voided:', e?.code || e);
            UIManager.showToast(t(isPermissionDenied(e) ? 'msg.expenses.void_failed' : 'msg.workers.not_saved'), 'error');
            return;
        }
        w.entries = w.entries.filter(e => e.id !== entryId);
        if (w.linked?.[entryId]) w.linked = Object.fromEntries(Object.entries(w.linked).filter(([k]) => k !== entryId));
        noteDue();
        render();
        refreshCash();
        UIManager.showToast(t('msg.workers.voided'), 'success');
        return;
    }
    const ok = await UIManager.showModal(t('msg.workers.remove_confirm', { amount: formatRupees(entry.amount), name: w.name }), t('ui.workers.remove'), true, { confirmLabel: t('ui.workers.remove'), danger: true });
    if (!ok) return;
    await save('workers.remove', async () => {
        await repo.removeEntry(w.id, entry);
        w.entries = w.entries.filter(e => e.id !== entryId);
    }, 'msg.workers.removed');
}

/** Signed out: nothing of the last owner's stays in memory. */
export function reset() {
    Object.assign(state, { workers: [], loaded: false, error: false, month: null, open: '', form: '', seq: state.seq + 1, rejoining: false });
}

export const WorkersManager = { init, render, reset, step, open, showForm, cancel, saveWorker, savePay, saveEdit, saveLeft, rejoin, removeEntry, refreshPayDue, keep, pick, addToMoney };
