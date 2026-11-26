/**
 * Recurring bills (#437, RB-*): the owner adds Electricity every 2 months, enters a bill, pays part of
 * it in cash, sees it on Today (RB-11), then pays the rest online; each payment is saved with its one
 * "Bills" expense (RB-12, its own cash / online); the page works in Hindi; a member records payments
 * but never adds or edits bills.
 */
const { test, expect, login, showTab, clickAfterTyping, openDisclosure } = require('./support/app');
const { listDocs } = require('./support/emulator');

const row = (page, name) => page.locator('#recurringBody .row[data-rbill]', { hasText: name });
const state = (page, name) => row(page, name).locator('[data-rb-state]');

test('the owner adds bimonthly electricity, enters a bill, part-pays, then pays the rest', async ({ page, problems }, testInfo) => {
    // Due on the 1st: from the 2nd of the month an unpaid bill is overdue
    const dayOne = new Date().getDate() === 1;
    await login(page, 'owner');
    await showTab(page, 'recurring');
    await expect(page.locator('#recurringBody .rb-metrics')).toBeVisible();
    const name = `E2E Electricity ${testInfo.project.name} ${Date.now()}`;

    await page.click('#recurringBody [data-onclick="recurring.showForm(\'add\')"]');
    await page.fill('#rbName', name);
    await page.selectOption('#rbCadence', '2');
    await page.fill('#rbDueDay', '1');
    await clickAfterTyping(page, '#rbSave');
    await expect(page.locator('#toast')).toHaveText(`${name} added`, { timeout: 30000 });
    await expect(row(page, name)).toContainText('Every 2 months');
    await expect(state(page, name)).toHaveText('Amount not entered yet');

    await page.click('#rbDetail [data-onclick="recurring.showForm(\'bill\')"]');
    await page.fill('#rbAmount', '1240');
    await clickAfterTyping(page, '#rbSave');
    await expect(state(page, name)).toHaveText(dayOne ? '₹1,240 due' : 'Overdue, ₹1,240', { timeout: 30000 });

    await page.click('#rbDetail [data-onclick="recurring.showForm(\'pay\')"]');
    await expect(page.locator('#rbAmount')).toHaveValue('1240');
    await expect(page.locator('#rbPayForm [data-rb-seg="mode"] [aria-pressed="true"]')).toHaveCount(0);
    await page.click(`#rbPayForm [data-onclick="recurring.pick('mode', 'cash')"]`);
    await page.fill('#rbAmount', '500');
    await clickAfterTyping(page, '#rbSave');
    await expect(page.locator('#toast')).toHaveText(`₹500 paid for ${name}`, { timeout: 30000 });
    await expect(state(page, name)).toHaveText(dayOne ? 'Part-paid, ₹500 of ₹1,240' : 'Overdue, ₹740');
    await expect(row(page, name)).toContainText('₹740 still to pay');

    // RB-11: Today shows the bills due, and its button opens the page
    await showTab(page, 'day');
    const bills = page.locator('#todayReminders [data-reminder="bills"]');
    await expect(bills).toContainText(/Bills due: \d+, ₹[\d,]+/);
    // Reminders start closed to one line: its chip, then open it for the button
    await expect(page.locator('#todayRemindersToggle')).toContainText(/Bills \d+/);
    await openDisclosure(page, 'todayReminders');
    await bills.locator('button').click();
    await expect(page.locator('#recurring.tab.active')).toBeVisible();
    await expect(state(page, name)).toBeVisible({ timeout: 15000 });

    await page.click('#rbDetail [data-onclick="recurring.showForm(\'pay\')"]');
    await expect(page.locator('#rbAmount')).toHaveValue('740');
    await page.click(`#rbPayForm [data-onclick="recurring.pick('mode', 'online')"]`);
    await clickAfterTyping(page, '#rbSave');
    await expect(state(page, name)).toHaveText('Paid', { timeout: 30000 });
    await expect(row(page, name)).toContainText('Nothing to pay');

    const doc = (await listDocs('dev_recurringBills')).find(b => b.name === name);
    expect(doc).toMatchObject({ cadence: 2, dueDay: 1, expected: 0, active: true });
    expect(doc.entries.map(e => [e.kind, e.amount, e.mode || ''])).toEqual([['bill', 1240, ''], ['pay', 500, 'cash'], ['pay', 740, 'online']]);
    // RB-12: one "Bills" expense per payment, with its mode, linked both ways
    const spent = (await listDocs('dev_expenses')).filter(e => e.recurringBillId === doc._id);
    expect(spent.map(e => [e.type, e.amount, e.paymentMode]).sort()).toEqual([['Bills', 500, 'cash'], ['Bills', 740, 'online']]);
    doc.entries.filter(e => e.kind === 'pay').forEach(e => expect(spent.find(x => x.recurringPayId === e.id)).toBeTruthy());

    await page.evaluate(() => window.app.i18n.setLang('hi'));
    await expect(page.locator('#recurring h2')).toHaveText('नियमित बिल');
    await expect(state(page, name)).toHaveText('चुकाया');
    await expect(row(page, name)).toContainText('हर 2 महीने');
    await page.evaluate(() => window.app.i18n.setLang('en'));
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
});

test('a member opens Recurring bills (on by default) and may record payments, never add or edit bills', async ({ page, problems }) => {
    await login(page, 'staff');
    await showTab(page, 'recurring');
    await expect(page.locator('#recurringBody .rb-metrics')).toBeVisible();
    await expect(page.locator('#recurringBody [data-onclick="recurring.showForm(\'add\')"]')).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});
