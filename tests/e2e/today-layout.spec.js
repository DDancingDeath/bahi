/**
 * Today layout (owner review, Nov 2026): Money now (hero, Cash in drawer, compact tiles) → Needs attention (Day report,
 * Reminders) → Settle today (Labour, Dues today) → Details (Items, Today's bills). Below the tiles every row is one
 * 52 px line, closed by default and remembered on the phone; at ≥ 1280 px two columns with open panels.
 */
const { test, expect, login, showTab, openDisclosure } = require('./support/app');
const { commit, deleteDocs } = require('./support/emulator');

const line = (itemId, name, qty, rate) => ({ itemId, name, qty, rate, total: qty * rate, weights: [qty] });
const bill = (id, billNumber, minutesAgo, customerName, lines, extra = {}) => {
    const t = Date.now() - minutesAgo * 60000;
    const total = lines.reduce((a, l) => a + l.total, 0);
    return {
        id, billNumber, timestamp: t, date: new Date(t).toISOString(), items: lines, customerName,
        billTotal: total, grandTotal: total, amountPayable: total, cashPayment: total, onlinePayment: 0, dueAmount: 0,
        payment: { cash: total, online: 0, due: 0, total }, userName: 'Owner', clientVersion: 3, openDue: false, ...extra
    };
};
const docs = (p) => ({
    purchases: [bill(`tl_p1_${p}`, `PTL1-${p}`, 30, 'Layout Farmer', [line('itm_wheat', 'Wheat', 70, 22), line('itm_rice', 'Rice', 40, 30)],
        { type: 'purchase', isPurchase: true, laborCharges: 12, totalPackets: 2 })],
    retail: [bill(`tl_r1_${p}`, `RTL1-${p}`, 20, 'Layout Ramesh', [line('itm_wheat', 'Wheat', 10, 26)]),
        bill(`tl_r2_${p}`, `RTL2-${p}`, 10, 'Layout Suresh', [line('itm_wheat', 'Wheat', 5, 26), line('itm_rice', 'A very long item name for one line', 2, 40)])],
    wholesale: [bill(`tl_w1_${p}`, `WTL1-${p}`, 15, 'Layout Traders', [line('itm_rice', 'Rice', 100, 33)])]
});

test.describe('Today layout', () => {
    let d;
    test.beforeEach(async () => {
        d = docs(test.info().project.name);
        await commit([...d.purchases.map(b => ['dev_purchases', b.id, b]), ...d.retail.map(b => ['dev_retailSales', b.id, b]),
            ...d.wholesale.map(b => ['dev_wholesaleSales', b.id, b])]);
    });
    test.afterEach(async () => {
        await deleteDocs('dev_purchases', d.purchases.map(b => b.id));
        await deleteDocs('dev_retailSales', d.retail.map(b => b.id));
        await deleteDocs('dev_wholesaleSales', d.wholesale.map(b => b.id));
    });

    test('phone at 360 px: the groups in order, one-line 52 px rows closed by default, items tables one line per item', async ({ page, problems }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'phone layout');
        await page.setViewportSize({ width: 360, height: 780 });
        await login(page, 'owner');
        await showTab(page, 'day');
        await expect(page.locator('#todayBillsCount')).toHaveText('4', { timeout: 30000 });
        await expect(page.locator('#appBarDate')).toBeVisible();
        await expect(page.locator('#appBarRefresh')).toBeHidden();
        await expect(page.locator('#todayDrawer')).toBeVisible({ timeout: 30000 });
        await expect(page.locator('#todayReminders')).toBeVisible({ timeout: 30000 });

        const ys = await page.evaluate(() => ['#dayTodayContent .hero', '#todayDrawer', '#dayTodayContent .today-metrics', '#todayAttentionTitle',
            '#todayReminders', '#todaySettleTitle', '#todayLabourToggle', '#todayDuesToggle', '#todayDetailsTitle', '#todayItemsToggle', '#todayBillsLink']
            .map(s => [s, document.querySelector(s)?.getBoundingClientRect().top ?? null]));
        ys.forEach(([s, y]) => expect([s, y === null]).toEqual([s, false]));
        expect(ys.map(([, y]) => y)).toEqual([...ys.map(([, y]) => y)].sort((a, b) => a - b));
        await expect(page.locator('[data-i18n="ui.today.transactions"], #todayMore, [data-i18n="ui.today.payment_breakdown"]')).toHaveCount(0);
        await expect(page.locator('#todayCashOnline')).toBeHidden();

        for (const id of ['todayReminders', 'todayLabour', 'todayDues', 'todayItems']) {
            await expect(page.locator(`#${id}Toggle`)).toHaveAttribute('aria-expanded', 'false');
        }
        // One line each: 48–60 px, the title and the key figure on the same line, nothing wraps or spills out
        const rows = await page.evaluate(() => [...document.querySelectorAll('#dayTodayContent .disclosure-line .disclosure-toggle, #todayBillsLink, #todayDrawer > .row')]
            .filter(el => el.offsetParent).map(el => {
                const r = el.getBoundingClientRect();
                const title = el.querySelector('.disclosure-title, .row-title')?.getBoundingClientRect();
                const sum = el.querySelector('.disclosure-summary, .row-trail')?.getBoundingClientRect();
                return { id: el.id || el.parentElement.id, h: Math.round(r.height), right: Math.round(r.right),
                    same: !!title && !!sum && Math.abs((title.top + title.bottom) / 2 - (sum.top + sum.bottom) / 2) < 6, sumH: sum ? Math.round(sum.height) : 0 };
            }));
        expect(rows.length).toBeGreaterThanOrEqual(6);
        rows.forEach(r => {
            expect([r.id, r.h >= 48 && r.h <= 60]).toEqual([r.id, true]);
            expect([r.id, r.same, r.sumH <= 26, r.right <= 360]).toEqual([r.id, true, true, true]);
        });
        const tools = await page.evaluate(() => [...document.querySelectorAll('#dayTodayContent .disclosure-line .disclosure-head > .btn-icon, #dayTodayContent .disclosure-line .disclosure-head > .menu > summary')]
            .filter(el => el.offsetParent).map(el => Math.round(el.getBoundingClientRect().width)));
        tools.forEach(w => expect(w).toBeGreaterThanOrEqual(44));

        // Items: tables per type, one line per item, no total row, ×2 on the item that is on two retail bills
        await openDisclosure(page, 'todayItems');
        await expect(page.locator('#todayItemsBody table')).toHaveCount(3);
        await expect(page.locator('#todayItemsBody tfoot')).toHaveCount(0);
        await expect(page.locator('#todayRetailItems .today-items-n')).toHaveText(['×2']);
        const table = await page.evaluate(() => [...document.querySelectorAll('#todayItemsBody table')].map(t => ({
            fits: t.scrollWidth <= t.clientWidth + 1, rowsH: [...t.querySelectorAll('tbody tr')].map(tr => Math.round(tr.getBoundingClientRect().height)) })));
        table.forEach(t => { expect(t.fits).toBe(true); t.rowsH.forEach(h => expect(h).toBeLessThanOrEqual(36)); });
        // Remembered through a redraw
        await showTab(page, 'billing');
        await showTab(page, 'day');
        await expect(page.locator('#todayItemsToggle')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#todayLabourToggle')).toHaveAttribute('aria-expanded', 'false');

        // Total in / out open the cash and online sheet
        await page.locator('.today-inout > .today-in').click();
        await expect(page.locator('.today-inout-split .row')).toHaveCount(4);
        expect(problems.pageErrors).toEqual([]);
    });

    test('desktop ≥ 1280 px: left tiles in one row, Items open, bills; right drawer, Needs attention, Labour and Dues open, Cash and online', async ({ page, problems }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
        await login(page, 'owner');
        await showTab(page, 'day');
        await expect(page.locator('#todayBillsCount')).toHaveText('4', { timeout: 30000 });
        await expect(page.locator('#appBarRefresh')).toBeVisible();
        await expect(page.locator('#appBarDate')).toBeVisible();
        const bar = await page.evaluate(() => ['#appBarRefresh', '#notifBell'].map(s => document.querySelector(s).getBoundingClientRect().left));
        expect(bar[0]).toBeLessThan(bar[1]);

        const box = (s) => page.locator(s).first().boundingBox();
        const main = await box('#dayTodayContent .today-main-top');
        const side = await box('#dayTodayContent .today-side');
        expect(side.x).toBeGreaterThan(main.x + main.width - 1);
        const sideKids = await page.evaluate(() => [...document.querySelector('#dayTodayContent .today-side').children].filter(e => e.offsetParent).map(e => e.id || e.className));
        expect(sideKids).toEqual(['todayDrawer', 'today-group today-attention', 'today-group', 'todayCashOnline']);
        const tiles = await page.evaluate(() => [...document.querySelectorAll('#dayTodayContent .today-metrics > .metric')].map(m => Math.round(m.getBoundingClientRect().top)));
        expect(new Set(tiles).size).toBe(1);
        await expect(page.locator('#todayLabourCard.panel-float .panel-legend')).toHaveText('Labour');
        await expect(page.locator('#todayDuesCard.panel-float .panel-legend')).toHaveText('Dues today');
        await expect(page.locator('#todayCashOnlineCard .row')).toHaveCount(4);
        await expect(page.locator('#todayLabourToggle, #todayDuesToggle, #todayItemsToggle')).toHaveCount(0);
        await expect(page.locator('#todayDetailsTitle')).toHaveText('Items');
        await expect(page.locator('.today-items-grid .panel-float')).toHaveCount(3);
        await expect(page.locator('#todayPurchaseItems')).toBeVisible();
        const bills = await box('#todayBillsLink');
        expect(bills.x).toBeLessThan(side.x);

        await page.locator('#appBarRefresh').click();
        await expect(page.locator('#toast')).toContainText('Updated');
        expect(problems.pageErrors).toEqual([]);
    });
});

test('Reminders and the Day report: one line each in Needs attention, start closed (unless the report opens itself) and remember a tap', async ({ page, problems }) => {
    await login(page, 'owner');
    await showTab(page, 'day');
    const reminders = page.locator('#todayRemindersToggle');
    const report = page.locator('#dayReportToggle');
    await expect(reminders).toBeVisible({ timeout: 30000 });
    await expect(report).toBeVisible({ timeout: 30000 });
    await expect(reminders).toHaveAttribute('aria-expanded', 'false');
    const auto = await page.evaluate(() => !!document.querySelector('[data-day-report-sev="high"], [data-day-report-health]'));
    if (!auto) await expect(report).toHaveAttribute('aria-expanded', 'false');
    await expect(reminders).toContainText('Backup');
    const order = await page.evaluate(() => [...document.querySelectorAll('#dayReportCard, #todayReminders')].map(e => e.id));
    expect(order).toEqual(['dayReportCard', 'todayReminders']);
    await expect(page.locator('#dayReportCard [data-onclick="anomalies.refreshNow()"]')).toHaveCount(0);
    await expect(page.locator('#dayReportCard .disclosure-head > .day-report-share > summary')).toBeVisible();

    await reminders.focus();
    await page.keyboard.press('Enter');
    await expect(reminders).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#todayRemindersBody [data-reminder="backup"] button')).toBeVisible();
    await openDisclosure(page, 'dayReport');
    await expect(page.locator('#dayReportBody [data-onclick="anomalies.openPage()"]')).toBeVisible();

    await showTab(page, 'billing');
    await showTab(page, 'day');
    await expect(page.locator('#todayRemindersToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#dayReportToggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#todayRemindersToggle').click();
    await expect(page.locator('#todayRemindersBody')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('happa.open.today-reminders'))).toBe('0');
    expect(problems.pageErrors).toEqual([]);
});
