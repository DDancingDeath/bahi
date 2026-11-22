/**
 * Anomalies row ⋯ menu (NEW-19): it floats over the rows below on a surface with a shadow, anchored to ⋯, and the
 * row doesn't move (phone 360 px and desktop, light, dark and Hindi). "Looks right" and ⋯ share one line.
 * A tap elsewhere, a pick or Esc closes it; Down moves into it.
 * Floating-label fields (NEW-20): the focus ring stays inside the border, so it never crosses the label.
 */
const { test, expect, login, showTab, settle } = require('./support/app');

const ROWS = [1, 2, 3].map(n => ({
    id: `e2e${n}`, type: 'numcheck-ac3', severity: 'high', status: 'open', dayKey: '2026-11-18', at: Date.UTC(2026, 10, 18, 12),
    refKind: 'bill', refId: `b${n}`, billType: 'sale', billNumber: `S20261118-00${n}`, party: 'Manoj Ram', amount: 20,
    en: 'Bill total = cash + online + due: expected ₹480, found ₹500', hi: 'बिल कुल = नकद + ऑनलाइन + उधार: चाहिए ₹480, मिला ₹500'
}));

// Draws three rows into a list of their own, so the page's own redraws can't replace them
const drawRows = (page, rows = ROWS) => page.evaluate(async (rows) => {
    const { AnomaliesManager } = await import('/js/modules/anomalies.js');
    document.getElementById('e2eAnomList')?.remove();
    const list = document.createElement('div');
    list.id = 'e2eAnomList';
    list.className = 'panel anom-list';
    list.innerHTML = rows.map(a => AnomaliesManager.rowHtml(a)).join('');
    document.getElementById('anomalyListView').prepend(list);
    list.scrollIntoView({ block: 'center' });
}, rows);

const layout = (page) => page.evaluate(() => {
    // Tops relative to the list, so a layout shift above it (the page still loading) isn't taken for a reflow
    const listTop = document.getElementById('e2eAnomList').getBoundingClientRect().top;
    const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top - listTop), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom - listTop), height: Math.round(r.height) }; };
    const rows = [...document.querySelectorAll('#e2eAnomList .anom-row')];
    const first = rows[0];
    const menu = first.querySelector('.anom-overflow-menu');
    const cs = getComputedStyle(menu);
    const mb = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(mb.left + mb.width / 2, mb.top + Math.min(mb.height / 2, 20));
    return {
        rows: rows.map(box),
        primary: box(first.querySelector('.anom-actions > .btn')),
        dots: box(first.querySelector('.anom-overflow > summary')),
        menu: box(menu),
        open: first.querySelector('.anom-overflow').open,
        position: cs.position,
        background: cs.backgroundColor,
        shadow: cs.boxShadow,
        zIndex: Number(cs.zIndex),
        onTop: !!hit && menu.contains(hit),
        vw: document.documentElement.clientWidth,
        surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    };
});

async function checkMenu(page, label) {
    await drawRows(page);
    const before = await layout(page);
    expect(before.open, label).toBe(false);
    expect(Math.abs(before.primary.top - before.dots.top), `${label}: Looks right and ⋯ on one line`).toBeLessThanOrEqual(4);

    await page.locator('#e2eAnomList .anom-row').first().locator('.anom-overflow > summary').click();
    const after = await layout(page);
    expect(after.open, label).toBe(true);
    expect(after.position, label).toBe('absolute');
    expect(after.rows, `${label}: no row moves or grows`).toEqual(before.rows);
    expect(after.primary, label).toEqual(before.primary);
    expect(after.dots, label).toEqual(before.dots);
    expect(after.background, `${label}: the menu has a surface`).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(after.shadow, label).not.toBe('none');
    expect(after.zIndex, label).toBeGreaterThanOrEqual(30);
    expect(after.onTop, `${label}: drawn over the next row`).toBe(true);
    expect(after.menu.left, label).toBeGreaterThanOrEqual(0);
    expect(after.menu.right, label).toBeLessThanOrEqual(after.vw);
    expect(after.menu.top >= after.dots.bottom || after.menu.bottom <= after.dots.top, `${label}: anchored to ⋯`).toBe(true);

    // Esc closes it and gives focus back to ⋯
    await page.keyboard.press('Escape');
    expect((await layout(page)).open, label).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.matches('#e2eAnomList .anom-overflow > summary'))).toBe(true);
    // Down opens it on the first pick; a tap elsewhere closes it
    await page.keyboard.press('ArrowDown');
    expect((await layout(page)).open, label).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.closest('.anom-overflow-menu') !== null)).toBe(true);
    await page.locator('#anomalySummary').click();
    expect((await layout(page)).open, label).toBe(false);
}

test('Anomalies ⋯ menu floats and the row does not reflow (light, dark, Hindi)', async ({ page, problems }, testInfo) => {
    if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 360, height: 780 });
    await login(page, 'owner');
    await showTab(page, 'anomalies');
    expect(await settle(page)).toBe(true);
    await expect(page.locator('#anomalyListView')).toBeVisible();
    await expect(page.locator('#anomalySummary')).toContainText('·');

    await checkMenu(page, 'light');
    await page.evaluate(() => { document.documentElement.dataset.mode = 'dark'; });
    await checkMenu(page, 'dark');
    await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; });
    await page.evaluate(() => window.app.i18n.setLang('hi'));
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('hi');
    await checkMenu(page, 'Hindi');
    await page.evaluate(() => window.app.i18n.setLang('en'));
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
});

test('phone: the last row\'s ⋯ just above the tab bar opens upwards, clear of the bar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'phone tab bar');
    await page.setViewportSize({ width: 360, height: 780 });
    await login(page, 'owner');
    await showTab(page, 'anomalies');
    expect(await settle(page)).toBe(true);
    // The last row is reviewed: its menu holds only Open, short enough to fit above the window's edge but not the bar
    await drawRows(page, [...ROWS, { ...ROWS[0], id: 'e2e4', status: 'ok' }]);
    await page.evaluate(() => {
        const list = document.getElementById('e2eAnomList');
        const spacer = document.createElement('div');
        spacer.style.height = '900px';
        list.after(spacer);
        const dots = [...list.querySelectorAll('.anom-overflow > summary')].pop();
        dots.scrollIntoView({ block: 'end' });
        const barTop = document.querySelector('.bottom-nav').getBoundingClientRect().top;
        let el = dots.parentElement;
        while (el && el !== document.body && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) el = el.parentElement;
        const scroller = el && el !== document.body ? el : document.scrollingElement;
        scroller.scrollBy(0, dots.getBoundingClientRect().bottom - (barTop - 40));
    });
    await page.locator('#e2eAnomList .anom-overflow > summary').last().click();
    const r = await page.evaluate(() => {
        const menu = [...document.querySelectorAll('#e2eAnomList .anom-overflow-menu')].pop();
        return { up: menu.hasAttribute('data-up'), bottom: menu.getBoundingClientRect().bottom, barTop: document.querySelector('.bottom-nav').getBoundingClientRect().top };
    });
    expect(r.up).toBe(true);
    expect(r.bottom).toBeLessThanOrEqual(r.barTop);
});

// NEW-20: the focus ring stays inside the border, under the label's notch, on Billing, Expenses and Cash fields
test('a focused floating-label field draws no ring over its label', async ({ page, problems }) => {
    await login(page, 'owner');
    const ring = (id) => page.evaluate((fieldId) => {
        const input = document.getElementById(fieldId);
        input.focus();
        const cs = getComputedStyle(input);
        const label = input.closest('.field-float').querySelector(':scope > label');
        const top = input.getBoundingClientRect().top;
        const lb = label.getBoundingClientRect();
        return { focused: document.activeElement === input, outline: cs.outlineStyle, shadow: cs.boxShadow, labelOverBorder: lb.top < top && lb.bottom > top };
    }, id);
    for (const [tab, id] of [['billing', 'newWeight'], ['expenses', 'businessExpenseDate'], ['expenses', 'businessExpenseAmount']]) {
        await showTab(page, tab);
        const r = await ring(id);
        expect(r.focused, id).toBe(true);
        expect(r.outline, id).toBe('none');
        expect(r.shadow, id).toMatch(/inset/);
        expect(r.labelOverBorder, id).toBe(true);
    }
    expect(problems.pageErrors).toEqual([]);
});
