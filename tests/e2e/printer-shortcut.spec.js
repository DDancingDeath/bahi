/**
 * Billing's printer button next to the bell (Android app only: a fake Bluetooth Serial plugin stands in
 * for it here). At 390 and 360 px it sits right before the bell, is at least 44 px, and the app bar fits;
 * its dot follows the printer; a tap opens the Settings printer panel in a sheet where a saved printer
 * connects with one tap, and closing the sheet leaves the bill as it was. Without the plugin it is not shown.
 */
const { test, expect, login, showTab, settle } = require('./support/app');

function fakePlugin(page) {
    return page.addInitScript(() => {
        localStorage.setItem('printerSettings', JSON.stringify({
            enabled: true, deviceId: 'AA:BB', deviceName: 'Counter',
            printers: [{ deviceId: 'AA:BB', deviceName: 'Counter', widthMm: 58 }]
        }));
        let up = false;
        window.bluetoothSerial = {
            connect: (id, ok) => setTimeout(() => { up = true; ok(); }, 400),
            disconnect: (ok) => { up = false; ok(); },
            isConnected: (ok, fail) => (up ? ok() : fail()),
            isEnabled: (ok) => ok(),
            list: (ok) => ok([{ name: 'Counter', address: 'AA:BB' }]),
            write: (bytes, ok) => ok()
        };
    });
}

const bar = (page) => page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const shown = [...document.getElementById('appBar').children].filter(el => el.offsetParent && getComputedStyle(el).display !== 'none');
    return {
        printer: box(document.getElementById('printerShortcut')),
        bell: document.getElementById('notifBell').hidden ? null : box(document.getElementById('notifBell')),
        parts: shown.map(el => ({ id: el.id || el.className, ...box(el) })),
        vw: innerWidth,
        scrollWidth: document.documentElement.scrollWidth
    };
});

for (const width of [390, 360]) {
    test(`printer button next to the bell and its sheet at ${width} px`, async ({ page, problems }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'phone app bar');
        await fakePlugin(page);
        await page.setViewportSize({ width, height: 800 });
        await login(page, 'owner');
        await showTab(page, 'billing');
        expect(await settle(page)).toBe(true);

        await page.fill('#customerName', 'Ramesh Kumar');
        await page.fill('#billRate', '2200');
        await page.fill('#newWeight', '52.5');

        const btn = page.locator('#printerShortcut');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute('data-state', 'saved');
        const got = await bar(page);
        const where = JSON.stringify(got);
        expect(got.printer.width, where).toBeGreaterThanOrEqual(44);
        expect(got.printer.height, where).toBeGreaterThanOrEqual(44);
        if (got.bell) {
            expect(got.printer.right, where).toBeLessThanOrEqual(got.bell.left + 1);
            expect(got.bell.left - got.printer.right, where).toBeLessThanOrEqual(16);
        }
        for (const p of got.parts) expect(p.right, `${p.id} inside the bar (${where})`).toBeLessThanOrEqual(got.vw + 0.5);
        const sorted = [...got.parts].sort((a, b) => a.left - b.left);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i].left, `no overlap (${where})`).toBeGreaterThanOrEqual(sorted[i - 1].right - 0.5);
        expect(got.scrollWidth, where).toBeLessThanOrEqual(got.vw);

        await btn.click();
        const sheet = page.locator('#printerSheet');
        await expect(sheet).toHaveClass(/active/);
        await expect(page.locator('#printerSheetBody #printerPanel')).toBeVisible();
        const connect = page.locator('#printerSheetBody .saved-printer-use');
        await expect(connect).toHaveText('Connect');
        await connect.click();
        await expect(btn).toHaveAttribute('data-state', 'connecting');
        await expect(btn).toHaveAttribute('data-state', 'connected');
        await expect(page.locator('#printerSheetBody #testPrintBtn')).toBeVisible();
        await expect(page.locator('#printerSheetBody #disconnectBtn')).toBeVisible();

        await page.click('#printerSheet [data-dismiss]');
        await expect(sheet).not.toHaveClass(/active/);
        await expect(page.locator('#billing')).toHaveClass(/active/);
        await expect(page.locator('#customerName')).toHaveValue('Ramesh Kumar');
        await expect(page.locator('#billRate')).toHaveValue('2200');
        await expect(page.locator('#newWeight')).toHaveValue('52.5');
        expect(await page.locator('#printerPanel').count()).toBe(1);

        await showTab(page, 'wholesale-sales');
        await expect(btn).toBeVisible();
        await showTab(page, 'day');
        await expect(btn).toBeHidden();

        expect(problems.pageErrors).toEqual([]);
        expect(problems.consoleErrors).toEqual([]);
    });
}

test('no printer button on the website (no Bluetooth plugin)', async ({ page, problems }) => {
    await login(page, 'owner');
    await showTab(page, 'billing');
    await expect(page.locator('#printerShortcut')).toBeHidden();
    expect(problems.pageErrors).toEqual([]);
});
