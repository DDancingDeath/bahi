/**
 * Today (owner feedback, 15 Nov 2026): the day's key figures come first; Reminders and the Day report
 * sit below them, each closed to one row by default (ui/disclosure.js). A tap opens it; the choice is
 * kept on this device.
 */
const { test, expect, login, showTab, openDisclosure } = require('./support/app');

test('Today opens on its figures; Reminders and the Day report start closed and remember a tap', async ({ page, problems }, testInfo) => {
    await login(page, 'owner');
    await showTab(page, 'day');
    const reminders = page.locator('#todayRemindersToggle');
    const report = page.locator('#dayReportToggle');
    // A new phone has no backup checked: the owner always has at least that reminder
    await expect(reminders).toBeVisible({ timeout: 30000 });
    await expect(report).toBeVisible({ timeout: 30000 });
    await expect(reminders).toHaveAttribute('aria-expanded', 'false');
    await expect(report).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#todayRemindersBody')).toBeHidden();
    await expect(page.locator('#dayReportBody')).toBeHidden();
    await expect(reminders).toContainText('Backup');

    const order = await page.evaluate(() => [...document.querySelectorAll('#dayTodayContent .today-metrics, #todayReminders, #dayReportCard, #todayLabourCard')].map(e => e.id || 'metrics'));
    expect(order).toEqual(['metrics', 'todayReminders', 'dayReportCard', 'todayLabourCard']);
    // The closed lines stay on one line at 360 px ("…" when they don't fit); Labour's shows Deducted · Est. pay
    if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 360, height: 780 });
    await expect(page.locator('#todayLabourToggle .disclosure-summary')).toContainText('Est. pay');
    const lines = await page.evaluate(() => ['#todayRemindersToggle', '#todayLabourToggle'].map(sel => {
        const el = document.querySelector(`${sel} .disclosure-summary`);
        const cs = getComputedStyle(el);
        return { sel, oneLine: el.getBoundingClientRect().height <= parseFloat(cs.lineHeight || '20') * 1.5 || el.getBoundingClientRect().height <= 24, nowrap: cs.whiteSpace, dot: !!document.querySelector(`${sel} [data-disclosure-alert]`) };
    }));
    lines.forEach(l => expect([l.sel, l.oneLine, l.nowrap]).toEqual([l.sel, true, 'nowrap']));
    expect(lines.find(l => l.sel === '#todayLabourToggle').dot).toBe(false);
    if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 });
    if (testInfo.project.name === 'phone') {
        const metrics = await page.locator('#dayTodayContent .today-metrics').boundingBox();
        const box = await page.locator('#todayReminders').boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(metrics.y + metrics.height);
        await expect.poll(async () => (await reminders.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // Keyboard: the row is a button
    await reminders.focus();
    await page.keyboard.press('Enter');
    await expect(reminders).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#todayRemindersBody [data-reminder="backup"] button')).toBeVisible();
    await openDisclosure(page, 'dayReport');
    await expect(page.locator('#dayReportBody [data-onclick="anomalies.openPage()"]')).toBeVisible();

    // Kept through a redraw of Today
    await showTab(page, 'billing');
    await showTab(page, 'day');
    await expect(page.locator('#todayRemindersToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#dayReportToggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#todayRemindersToggle').click();
    await expect(page.locator('#todayRemindersBody')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('happa.open.today-reminders'))).toBe('0');
    expect(problems.pageErrors).toEqual([]);
});
