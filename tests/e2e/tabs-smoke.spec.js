/**
 * Every-page smoke (#127): owner, manager and member open every page and
 * section they may see, in English and Hindi, on phone and desktop (the two
 * Playwright projects). Each screen must show no page or console error, no
 * NaN / undefined / null / [object Object] / Invalid Date / raw i18n key, and
 * no text that mixes English and Hindi, no Hindi on an English screen and no
 * English on a Hindi screen (beyond the allow-list in screenFindings). Each page
 * must stay inside its read budget (support/read-budget.js, read-baselines.json).
 * Pages a role may not open must redirect. Logged out: login, register, reset,
 * /download and the tenant link page /r/<token>.
 * Each test starts from a freshly seeded emulator (support/seed.js), so its read
 * counts do not depend on which specs ran before it in the shard.
 */
const { test, expect, login, openApp, showTab, settle } = require('./support/app');
const { TENANT_TOKEN } = require('./support/emulator');
const { seed } = require('./support/seed');
const { RECORD, settledReads, overBudget, recordBaselines } = require('./support/read-budget');

const A = ['owner', 'manager', 'staff'];
const OM = ['owner', 'manager'];
const O = ['owner'];
const M = ['staff']; // "Member"
// showTabFromNav draws a page's default sub-tab in a setTimeout of this many ms.
const NAV_TIMER_MS = 100;
// Background reads after the app shows: AnomaliesManager.scheduleDailyScan() (8 s) and the legacy scan (>= 3 s).
const START_UP_WORK_MS = 8500;
// A step's reads count once the read meter has been still this long (at most STEP_READS_TIMEOUT_MS).
const STEP_READS_QUIET_MS = 500;
const STEP_READS_TIMEOUT_MS = 3000;

// The specs that add data (bill-flow, edit-bill, rentals) may run before this one in a shard: start every test from the seed.
test.beforeEach(async () => {
    await seed();
});

// name, route (nav.showTab), page (.tab id that must show), act (JS run after the page opened), roles,
// expect (selector that must be visible: the step's own section or active sub-tab), hidden (selectors that must stay hidden),
// timers (act's own setTimeout delay to let fire), settle (ms the screen may take to stop loading; default 10 s)
const STEPS = [
    { name: 'Today', route: 'day', page: 'day', act: "window.app.day.showSubTab('today')", roles: A, expect: '#dayTodayContent' },
    { name: 'Today › Add reminder', route: 'day', page: 'day', act: "(window.app.day.showSubTab('today'), window.app.day.reminderForm(true))", roles: OM, expect: '#todayReminders #reminderTitle' },
    { name: 'Today › Cash', route: 'day', page: 'day', act: "window.app.day.showSubTab('cash')", roles: A, expect: '#dayCashContent' },
    { name: 'Billing › Purchase', route: 'billing', page: 'billing', roles: A, expect: '#purchaseSection' },
    { name: 'Billing › Retail sale', route: 'billing', page: 'billing', act: "window.app.billing.switchMode('sale', { currentTarget: document.getElementById('saleModeBtn') })", roles: A, expect: '#saleSection' },
    { name: 'Wholesale › Sale', route: 'wholesale-sales', page: 'wholesale-sales', roles: OM, expect: '#salesEntrySection' },
    // Wholesale has no History / Outstanding tabs of its own (F14): its links open the global pages with Wholesale picked
    { name: 'Wholesale › Wholesale bills', route: 'wholesale-sales', page: 'history', act: "document.querySelector('#wholesale-sales .ws-links [data-onclick*=\"wholesale-history\"]').click()", timers: 150, roles: OM, expect: '#history .filter-wholesale.active' },
    { name: 'Wholesale › Wholesale dues', route: 'wholesale-sales', page: 'due', act: "document.querySelector('#wholesale-sales .ws-links [data-onclick*=\"wholesale-outstanding\"]').click()", timers: 150, roles: OM, expect: '#dueSaleKinds [data-due-kind="wholesale"].active' },
    // NEW-01: the links' Wholesale filter is for that visit only; the tab bar opens the pages as usual
    { name: 'History from the tab bar after Wholesale bills', route: 'history', page: 'history', roles: OM, expect: '#history .filter-purchase.active', hidden: ['#history .filter-wholesale.active'] },
    { name: 'Outstanding from the tab bar after Wholesale dues', route: 'due', page: 'due', roles: OM, expect: '#dueSaleKinds [data-due-kind="sale"].active', hidden: ['#dueSaleKinds [data-due-kind="wholesale"].active'] },
    { name: 'Expenses › Business', route: 'expenses', page: 'expenses', roles: A, expect: '#businessExpenseSection' },
    // Off for managers and members until the owner turns it on (#98)
    { name: 'Expenses › Personal', route: 'expenses', page: 'expenses', act: "window.app.expenses.filterExpenseTab('personal')", roles: O, expect: '#personalExpenseSection' },
    { name: 'Rates', route: 'rates', page: 'items', roles: A },
    { name: 'History › Purchase', route: 'history', page: 'history', act: "window.app.history.filterHistory('purchase')", roles: A, expect: '#history .filter-purchase.active' },
    { name: 'History › Sale', route: 'history', page: 'history', act: "window.app.history.filterHistory('sale')", roles: A, expect: '#history .filter-sale.active' },
    { name: 'History › Wholesale', route: 'wholesale-history', page: 'history', roles: OM, expect: '#history .filter-wholesale.active' },
    // A member without Wholesale has no Wholesale tab; the old link lands on History unfiltered
    { name: 'History › no Wholesale for a member', route: 'wholesale-history', page: 'history', roles: M, expect: '#history .history-type-filter .active', hidden: ['#history .filter-wholesale'] },
    { name: 'Stock › Current', route: 'stock', page: 'stock', roles: A, expect: '#currentStockSection' },
    { name: 'Stock › Not selling', route: 'stock', page: 'stock', act: "window.app.stock.filterTab('dead')", roles: OM, expect: '#deadStockSection' },
    { name: 'Stock › Adjustment', route: 'stock', page: 'stock', act: "window.app.stock.filterTab('adjustment')", roles: OM, expect: '#stockAdjustmentSection' },
    { name: 'Stock › Opening stock', route: null, page: 'stock', act: 'window.app.settings.openOpeningStock()', roles: OM, timers: 150, expect: '#stockAdjustmentSection' },
    // Members may not open Not selling or Adjustment (stock.js filterStockTab): the Current screen stays.
    { name: 'Stock › Not selling and Adjustment stay closed', route: 'stock', page: 'stock', act: "(window.app.stock.filterTab('dead'), window.app.stock.filterTab('adjustment'))", roles: M, expect: '#currentStockSection', hidden: ['#deadStockSection', '#stockAdjustmentSection', '#deadStockTabBtn'] },
    { name: 'Outstanding › Purchase', route: 'due', page: 'due', act: "window.app.outstanding.filterDue('purchase', { target: document.querySelector('#due .filter-purchase') })", roles: A, expect: '#due .filter-purchase.active' },
    { name: 'Outstanding › Sale', route: 'due', page: 'due', act: "window.app.outstanding.filterDue('sale', { target: document.querySelector('#due .filter-sale') })", roles: A, expect: '#due .filter-sale.active' },
    { name: 'Outstanding › Wholesale', route: 'wholesale-outstanding', page: 'due', roles: OM, expect: '#dueSaleKinds [data-due-kind="wholesale"].active' },
    { name: 'Money › Profit', route: 'money-profit', page: 'money', roles: OM, expect: '#moneyProfit' },
    // One Cash home (F62): money-cash opens Profit's "Money in and out", which links to Today › Cash
    { name: 'Money › Money in and out', route: 'money-cash', page: 'money', roles: OM, expect: '#moneyProfit #moneyCash [data-go="day-cash"]' },
    { name: 'Money › Spending', route: 'money-spending', page: 'money', roles: OM, expect: '#moneySpending' },
    { name: 'Money › Worth', route: 'money-worth', page: 'money', roles: OM, expect: '#moneyWorth' },
    // Labour day by day: owner and manager, from the bills and expenses already loaded (no reads of its own)
    { name: 'Money › Labour', route: 'money-labour', page: 'money', roles: OM, expect: '#moneyLabourHistory:not([hidden]) #lhBalance strong' },
    { name: 'Money › Compare with last month', route: 'money-profit', page: 'money', act: "window.app.money.setCompare('last-month')", roles: OM, expect: '#moneyCmpCard:not([hidden]) [data-cmp-row="M1"]' },
    { name: 'Insights › Actions', route: 'insights-actions', page: 'insights', roles: OM, expect: '#insights [data-insights-pane="actions"]' },
    { name: 'Insights › Items', route: 'insights-items', page: 'insights', roles: OM, expect: '#insights [data-insights-pane="items"]' },
    { name: 'Insights › Parties', route: 'insights-parties', page: 'insights', roles: OM, expect: '#insights [data-insights-pane="parties"]' },
    { name: 'Insights › Seasons', route: 'insights-seasons', page: 'insights', roles: OM, expect: '#insights [data-insights-pane="seasons"]' },
    { name: 'Insights › Seasons › Trends', route: 'insights-trends', page: 'insights', roles: OM, expect: '#insights #rtRatesSection' },
    { name: 'Insights › Seasons › Product traffic', route: 'insights-traffic', page: 'insights', roles: OM, expect: '#insights #rtTrafficSection' },
    { name: 'Statements', route: 'statements', page: 'statements', roles: OM, expect: '#statementsList' },
    { name: 'Statements › Day', route: 'statements-day', page: 'statements', roles: OM, expect: `#statementsControls [data-onchange*="dayPreset("]` },
    { name: 'Statements › Month', route: 'statements-month', page: 'statements', roles: OM, expect: `#statementsControls [data-onchange*="set('month'"]` },
    { name: 'Statements › Party', route: 'statements-party', page: 'statements', roles: OM, expect: `#statementsControls [data-onchange*="set('partyKey'"]` },
    { name: 'Statements › Item', route: 'statements-item', page: 'statements', roles: OM, expect: `#statementsControls [data-onchange*="set('itemKey'"]` },
    { name: 'Statements › CSV', route: 'statements-csv', page: 'statements', roles: O, expect: `#statementsControls [data-onchange*="set('csvFrom'"]` },
    { name: 'Statements › Accountant CSV', route: 'statements-accountant', page: 'statements', roles: O, expect: `#statementsControls [data-onchange*="set('csvFrom'"]` },
    // Exports are the owner's (#103): a manager is sent back to the list, with no export buttons.
    { name: 'Statements › CSV stays closed', route: 'statements-csv', page: 'statements', roles: ['manager'], expect: '#statementsList', hidden: ['#statementsActions', '#statementsView'] },
    { name: 'Ask', route: 'ask', page: 'ask', act: "window.app.ask.ask(document.documentElement.lang === 'hi' ? 'आज की बिक्री' : 'aaj ki bikri')", roles: A, expect: '#askAnswers .ask-answer' },
    { name: 'Anomalies › List', route: 'anomalies', page: 'anomalies', roles: OM, expect: '#anomalyListView' },
    { name: 'Anomalies › Patterns', route: 'anomalies', page: 'anomalies', act: "window.app.anomalies.showView('patterns')", roles: OM, expect: '#anomalyTabPatterns.active' },
    { name: 'App health', route: 'health', page: 'health', roles: OM },
    { name: 'Workers', route: 'workers', page: 'workers', roles: O, expect: '#workersBody .wp-metrics' },
    { name: 'Recurring bills', route: 'recurring', page: 'recurring', roles: O, expect: '#recurringBody .rb-metrics' },
    { name: 'Admin › Users', route: 'admin', page: 'admin', act: "window.app.admin.showTab('users')", roles: O, expect: '#adminTeamLink' },
    { name: 'Admin › Data', route: 'admin', page: 'admin', act: "window.app.admin.showTab('data')", roles: O, expect: '#adminContainer .danger-zone' },
    { name: 'Diagnostics › Number checks', route: 'diagnostics', page: 'diagnostics', act: "window.app.diagnostics.showTab('numbers')", roles: OM, expect: '#diagnosticsContainer .diag-numchecks-intro' },
    { name: 'Diagnostics › Errors', route: 'diagnostics', page: 'diagnostics', act: "window.app.diagnostics.showTab('errors')", roles: O, expect: '#diagTypeFilter' },
    { name: 'Diagnostics › Audit', route: 'diagnostics', page: 'diagnostics', act: "window.app.diagnostics.showTab('audit')", roles: O, expect: '#auditFilterAction' },
    { name: 'Settings', route: 'settings-common', page: 'settings', roles: A, expect: '#settingsGroups [data-settings-open="help"]', hidden: ['#settingsAppearance'] },
    { name: 'Settings › Appearance', route: 'settings-appearance', page: 'settings', roles: A, expect: '#themeGallery', hidden: ['#settingsHome'] },
    { name: 'Settings › Printing & receipts', route: 'settings-printing', page: 'settings', roles: A, expect: '#receiptSettingsCard' },
    { name: 'Settings › Billing tools', route: 'settings-billing', page: 'settings', roles: A, expect: '#photoWeightsCard' },
    { name: 'Settings › Help & about', route: 'settings-help', page: 'settings', roles: A, expect: '#usageCard' },
    { name: 'Settings › Aadhat', route: 'settings-shop', page: 'settings', roles: OM, expect: '#settingsShop' },
    { name: 'Settings › Aadhat stays closed', route: 'settings-shop', page: 'settings', roles: ['staff'], expect: '#settingsHome', hidden: ['#settingsShop', '#settingsGroups [data-settings-open="shop"]', '#settingsGroups [data-settings-open="team"]'] },
    { name: 'Settings › Rentals', route: 'settings-rentals', page: 'settings', roles: OM, expect: '#settingsRentals' },
    { name: 'Settings › Team', route: 'settings-roles', page: 'settings', roles: O, expect: '#roleAccessCard' },
    { name: 'Settings › Team stays closed', route: 'settings-team', page: 'settings', roles: ['manager', 'staff'], expect: '#settingsHome', hidden: ['#settingsTeam'] },
    { name: 'Rentals › This month (Who owes)', route: null, page: 'rentals', act: "window.app.rentals.open('rent')", roles: A, expect: '#rentalsBody [data-rent-by="owes"][aria-pressed="true"]' },
    { name: 'Rentals › This month by property', route: null, page: 'rentals', act: "window.app.rentals.viewBy('properties')", roles: A, expect: '#rentalsBody [data-rent-by="properties"][aria-pressed="true"]' },
    { name: 'Rentals › This month by unit', route: null, page: 'rentals', act: "window.app.rentals.viewBy('units')", roles: A, expect: '#rentUnitList' },
    { name: 'Rentals › old Advanced call', route: null, page: 'rentals', act: "window.app.rentals.setMode('advanced')", roles: A, expect: '#rentalsBody [data-rent-by="properties"][aria-pressed="true"]' },
    { name: 'Rentals › Tenants', route: null, page: 'rentals', act: "window.app.rentals.page('tenants')", roles: A, expect: '#rentals [data-rent-page="tenants"].active:visible, #bottomNav [data-rent-bar="tenants"].active:visible' },
    { name: 'Rentals › Properties', route: null, page: 'rentals', act: "window.app.rentals.page('properties')", roles: A, expect: '#rentals [data-rent-page="properties"].active:visible, #bottomNav [data-rent-bar="properties"].active:visible' },
    { name: 'Rentals › Reports', route: null, page: 'rentals', act: "window.app.rentals.page('reports')", roles: A, expect: '#rentals [data-rent-page="reports"].active:visible, #bottomNav [data-rent-bar="reports"].active:visible' },
    { name: 'Rentals › ⋯ menu with Roles & access', route: null, page: 'rentals', act: "document.getElementById('rentSettingsLinks').open = true", roles: O, expect: '#rentRolesLink', close: "document.getElementById('rentSettingsLinks').open = false" },
    { name: 'Rentals › ⋯ menu without Roles & access', route: null, page: 'rentals', act: "document.getElementById('rentSettingsLinks').open = true", roles: ['manager', 'staff'], expect: '#rentSettingsLinks .rent-menu-list', hidden: ['#rentRolesLink'], close: "document.getElementById('rentSettingsLinks').open = false" },
    { name: 'Rentals › Access', route: null, page: 'settings', act: "window.app.rentals.page('access')", roles: O, timers: NAV_TIMER_MS, expect: '#roleAccessCard' },
    { name: 'Back to Aadhat', route: null, page: null, act: "window.app.business.set('shop')", roles: A, wait: 600 },
    { name: 'Notifications', route: null, page: null, act: 'window.app.notifications.open()', roles: A, overlay: '#notifPanel', close: 'window.app.notifications.close()' },
    { name: "What's new", route: null, page: null, act: 'window.app.updates.showWhatsNew()', roles: A, overlay: '#whatsNewSheet', close: "document.querySelector('#whatsNewSheet [data-dismiss]')?.click()" }
];

// What a route shows once showTabFromNav's own first render (setTimeout NAV_TIMER_MS) has run: the page's default sub-tab.
// A step's act runs only after this, so that first render cannot undo it.
const ROUTE_READY = {
    day: '#day .day-container > .tabs [aria-selected="true"]',
    billing: '#purchaseSection',
    'wholesale-sales': '#salesEntrySection',
    history: '#history .history-type-filter .active',
    stock: '#currentStockSection',
    // Sales first, or the list last opened this session (U-69)
    due: '#due .due-seg > .active',
    anomalies: '#anomalies .anom-filter-box + .tabs [aria-selected="true"]',
    admin: '#adminTabsContainer [aria-selected="true"]',
    diagnostics: '#diagnosticsTabsContainer [aria-selected="true"]'
};

// Pages each role may not open: showTab must land somewhere else.
const BLOCKED = {
    manager: [['admin', 'admin'], ['workers', 'workers'], ['recurring', 'recurring']],
    staff: [['wholesale-sales', 'wholesale-sales'], ['money', 'money'], ['money-cash', 'money'], ['money-labour', 'money'],
        ['insights', 'insights'], ['insights-seasons', 'insights'], ['insights-trends', 'insights'], ['rate-trends', 'insights'],
        ['statements', 'statements'], ['anomalies', 'anomalies'], ['health', 'health'], ['admin', 'admin'], ['diagnostics', 'diagnostics'], ['workers', 'workers'], ['recurring', 'recurring']]
};

// Old page ids (owner): where each one lands now.
const OLD_IDS = [['items', 'items'], ['finance', 'money'], ['reports', 'statements'], ['analytics', 'insights'], ['rate-trends', 'insights'],
    ['rates-trends', 'insights'], ['rates-traffic', 'insights'], ['reports-trends', 'insights'], ['reports-traffic', 'insights'],
    ['settings-aadhat', 'settings'], ['admin-configure', 'settings']];

/** In the page: findings for the visible screen (active page + open sheets), in `lang`. */
function screenFindings({ lang, roots }) {
    const vis = (el) => !!el && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const els = [];
    for (const sel of roots) document.querySelectorAll(sel).forEach(el => { if (vis(el) && !els.some(e => e.contains(el))) els.push(el); });
    // Test data, product names and code identifiers (App health policy keys) are the same in both languages.
    const DATA = /\b[\w-]+\.apk\b|\b[\w-]+\.(web\.app|local)\b(\/[\w./-]*)?|happa|\bBahi\b|Tenant E2E|E2E (Shop|Bhawan)|\bE2E\b|\b(phone|desktop)\b|PEDIT-\w+|\b(Before|After) Edit\b|Gali \d+|Ram \d+|\bG\d+\b|Manager One|Staff One|Pending Person|\bOwner\b|Rice|Wheat|Mustard|चावल|गेहूं|सरसों|[\w.+-]+@[\w.-]+|https?:\/\/\S+|\bkg\b|\bKG\b|WhatsApp|\bUPI\b|\bPDF\b|\bCSV\b|Excel|\bOK\b|\bID\b|\bGST\b|Bluetooth|Android|\bAPK\b|Google|GPay|Chrome|Edge|Safari|iPhone|iPad|Firebase|\bJSON\b|DEVELOPMENT|\b[a-z]+[A-Z]\w*\b|"[a-z]+(-[a-z]+)+"|"\w+":\s*(true|false)\b/g;
    const dev = /[\u0900-\u097F]/;
    const latin = /[A-Za-z]{3,}/;
    const out = { bad: [], mixed: [], wrongLang: [], english: [] };
    const seen = new Set();
    const look = (raw, where) => {
        const s = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!s || seen.has(s)) return;
        seen.add(s);
        const bad = s.match(/\bNaN\b|\bundefined\b|\bnull\b|\[object Object\]|Invalid Date|\b(ui|msg)\.[a-z_]+\.[a-z0-9_.]+/);
        if (bad) out.bad.push(`${where}"${s.slice(0, 90)}"`);
        const rest = s.replace(DATA, ' ');
        const hasDev = dev.test(rest);
        const hasLat = latin.test(rest);
        if (hasDev && hasLat) out.mixed.push(`${where}"${s.slice(0, 90)}"`);
        else if (lang === 'en' && hasDev) out.wrongLang.push(`${where}"${s.slice(0, 90)}"`);
        else if (lang === 'hi' && hasLat) out.english.push(`${where}"${s.slice(0, 60)}"`);
    };
    for (const root of els) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            const p = n.parentElement;
            if (!p || p.closest('script,style,noscript,[data-lang-option],.auth-lang-links,#navLangToggle,.dev-banner') || !vis(p)) continue;
            // Text marked as the other language on purpose (a language switch button) or as no language (lang="zxx": a device id).
            const marked = p.closest('[lang]:not(html)');
            if (marked && marked.lang && marked.lang !== lang) continue;
            look(n.textContent, '');
        }
        root.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(el => { if (vis(el)) look(el.placeholder, 'placeholder: '); });
        root.querySelectorAll('select').forEach(el => { if (vis(el)) [...el.options].slice(0, 20).forEach(o => look(o.text, 'option: ')); });
    }
    return out;
}

const activeTab = (page) => page.evaluate(() => document.querySelector('.tab.active')?.id || null);

/**
 * Runs the expression `js` in the page (awaiting a returned promise), then lets the timers it set with a delay of up to
 * `timers` ms fire: the browser runs a timer only after every earlier one with an equal or shorter delay.
 */
async function run(page, js, timers = 0) {
    await page.evaluate(`(async () => { await (${js}); if (${timers}) await new Promise(r => setTimeout(r, ${timers})); })()`);
}

function record(all, step, f) {
    for (const k of Object.keys(all)) (f[k] || []).forEach(x => all[k].push(`${step}: ${x}`));
}

/** Read-budget bucket of a step: its page, else its name ("Notifications" -> "notifications"). */
const bucketOf = (s) => s.page || s.name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

for (const role of A) {
    for (const lang of ['en', 'hi']) {
        test(`${role} (${lang}) opens every page and section without errors`, async ({ page, problems }) => {
            test.setTimeout(360000);
            await login(page, role);
            // Two jobs read on a timer, not because a page opened: the rate-stats roll-forward (main.js, 20 s after start,
            // owner / manager) and the old-notifications cleanup (30 s). Mark them as just run so they never land on
            // whichever page is open then (they did on History, 22 Nov).
            await page.evaluate(() => {
                const uid = window.firebase.auth().currentUser.uid;
                localStorage.setItem('aadhatRateStatsRoll', JSON.stringify({ uid, at: Date.now() }));
                localStorage.setItem(`aadhat.notifications.cleanupAt.${uid}`, String(Date.now()));
            });
            await page.evaluate((l) => window.app.i18n.setLang(l), lang);
            await page.waitForTimeout(300);
            // Start-up reads: login until the read meter is still. Background start-up work reads too (legacy
            // timestamp scan ~3-4 s, daily anomaly scan 8 s after the app shows): count it as start-up, not
            // as whichever page happens to be open when it runs.
            await page.waitForFunction((ms) => {
                const shown = performance.getEntriesByName('aadhat:app-shown')[0];
                return !!shown && performance.now() - shown.startTime > ms;
            }, START_UP_WORK_MS, { polling: 250, timeout: 60000 });
            let mark = await settledReads(page, { quiet: 1500 });
            expect(mark, 'the app exposes its read meter').not.toBeNull();
            const reads = { startup: mark };
            const all = { bad: [], mixed: [], wrongLang: [], english: [], stuck: [] };
            const side = await page.evaluate(screenFindings, { lang, roots: ['.side-nav'] });
            record(all, 'Side menu', side);

            for (const s of STEPS.filter(x => x.roles.includes(role))) {
                await test.step(s.name, async () => {
                    if (s.route) {
                        await run(page, `window.app.nav.showTab(${JSON.stringify(s.route)})`, NAV_TIMER_MS);
                        const ready = ROUTE_READY[s.route];
                        if (ready) await expect(page.locator(ready).first(), `${s.route} opens on its default sub-tab`).toBeVisible();
                        await expect(page.locator('#loadingOverlay.active')).toHaveCount(0);
                    }
                    if (s.act) await run(page, s.act, s.timers);
                    if (s.wait) await page.waitForTimeout(s.wait);
                    if (s.page) {
                        await expect.poll(() => activeTab(page), { message: `${s.name} shows #${s.page}` }).toBe(s.page);
                    }
                    if (s.expect) await expect(page.locator(s.expect).first(), `${s.name} shows ${s.expect}`).toBeVisible();
                    for (const sel of s.hidden || []) await expect(page.locator(sel), `${s.name} keeps ${sel} hidden`).toBeHidden();
                    if (s.overlay) await expect(page.locator(s.overlay)).toBeVisible();
                    if (!(await settle(page, s.settle))) all.stuck.push(s.name);
                    const roots = s.overlay ? [s.overlay] : ['.tab.active', '#modalOverlay.active', '.app-scrim.page-sheet.active'];
                    record(all, s.name, await page.evaluate(screenFindings, { lang, roots }));
                    if (s.close) {
                        await page.evaluate(s.close);
                        await page.waitForTimeout(250);
                    }
                    // Reads since the previous step belong to this step's page (first open: each test is a fresh session).
                    // Wait for the page's reads to stop first, so a slow page's late reads do not land on the next page.
                    const now = await settledReads(page, { quiet: STEP_READS_QUIET_MS, timeout: STEP_READS_TIMEOUT_MS, poll: 100 });
                    const b = bucketOf(s);
                    reads[b] = (reads[b] || 0) + (now - mark);
                    mark = now;
                });
            }

            if (lang === 'en') {
                for (const [route, tab] of BLOCKED[role] || []) {
                    await test.step(`blocked: ${route}`, async () => {
                        await page.evaluate((r) => window.app.nav.showTab(r), route);
                        await page.waitForTimeout(400);
                        const now = await activeTab(page);
                        expect(now, `${role} may not open ${route}`).not.toBe(tab);
                        expect(['billing', 'day']).toContain(now);
                    });
                }
                if (role === 'owner') {
                    for (const [route, tab] of OLD_IDS) {
                        await test.step(`old id: ${route}`, async () => {
                            await showTab(page, route);
                            expect(await activeTab(page)).toBe(tab);
                        });
                    }
                    await test.step('Items & rates has no Trends; Insights › Seasons hosts it', async () => {
                        const nav = await page.locator('.nav-menu').first().textContent();
                        expect(nav).toContain('Items & rates');
                        expect(nav).not.toContain('Rate trends');
                        await expect(page.locator('#items .rates-subtabs')).toHaveCount(0);
                        await expect(page.locator('#insights #rate-trends')).toHaveCount(1);
                        await expect(page.locator('#finance, #reports, #analytics')).toHaveCount(0);
                        await showTab(page, 'reports-traffic');
                        await expect(page.locator('#rtTrafficSection')).toBeVisible();
                        await showTab(page, 'rates');
                        await expect(page.locator('#items')).toBeVisible();
                        await expect(page.locator('#rtTrafficSection')).toBeHidden();
                    });
                }
            }

            if (all.english.length) console.log(`[${role} ${lang}] English text on the Hindi screen (${all.english.length}):\n  ${all.english.join('\n  ')}`);
            test.info().annotations.push({ type: 'reads', description: JSON.stringify({ role, lang, reads }) });
            recordBaselines(role, reads);
            expect.soft(all.english, 'English text on the Hindi screen').toEqual([]);
            expect.soft(overBudget(role, reads), `pages over their read budget${RECORD ? ' (record mode: hard cap only)' : ''}`).toEqual([]);
            expect(all.bad, 'NaN / undefined / null / [object Object] / raw keys').toEqual([]);
            expect(all.mixed, 'text mixing English and Hindi').toEqual([]);
            expect(all.wrongLang, 'Hindi text on the English screen').toEqual([]);
            expect(all.stuck, 'pages still loading after 10 s').toEqual([]);
            expect(problems.pageErrors).toEqual([]);
            expect(problems.consoleErrors).toEqual([]);
        });
    }
}

for (const lang of ['en', 'hi']) {
    test(`logged out (${lang}): login, register, reset, /download and the tenant link page`, async ({ page, problems }) => {
        await page.addInitScript((l) => { localStorage.setItem('aadhat.lang', l); localStorage.setItem('happa.rentLang', l); }, lang);
        const all = { bad: [], mixed: [], wrongLang: [], english: [] };
        await openApp(page);
        record(all, 'Login', await page.evaluate(screenFindings, { lang, roots: ['#authScreen'] }));
        await page.evaluate(() => window.app.auth.showTab('register'));
        await expect(page.locator('#registerForm')).toBeVisible();
        record(all, 'Register', await page.evaluate(screenFindings, { lang, roots: ['#authScreen'] }));
        await page.evaluate(() => window.app.auth.showTab('login'));
        await page.click('#resetToggle');
        await expect(page.locator('#resetForm')).toBeVisible();
        record(all, 'Reset', await page.evaluate(screenFindings, { lang, roots: ['#authScreen'] }));

        const res = await page.goto('/download', { waitUntil: 'load' });
        expect(res.ok()).toBe(true);
        await expect(page.locator('#downloadBtn')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        record(all, '/download', await page.evaluate(screenFindings, { lang, roots: ['body'] }));

        await page.goto(`/r/${TENANT_TOKEN}?d=1&emulator=1`, { waitUntil: 'load' });
        await expect(page.locator('#rh')).toContainText('Tenant E2E');
        await expect(page.locator('#rh')).toContainText('3,000');
        record(all, '/r/<token>', await page.evaluate(screenFindings, { lang, roots: ['body'] }));

        if (all.english.length) console.log(`[logged out ${lang}] English text on the Hindi screen (${all.english.length}):\n  ${all.english.join('\n  ')}`);
        expect.soft(all.english, 'English text on the Hindi screen').toEqual([]);
        expect(all.bad).toEqual([]);
        expect(all.mixed).toEqual([]);
        expect(all.wrongLang).toEqual([]);
        expect(problems.pageErrors).toEqual([]);
        expect(problems.consoleErrors).toEqual([]);
    });
}
