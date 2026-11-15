/** Login gate in a real browser (#127, #96): pending users stay out; staff see a reduced menu. */
const { test, expect, login } = require('./support/app');

test('pending user waits on the approval card with Check again (U-24)', async ({ page, problems }) => {
    await login(page, 'pending');
    await expect(page.locator('#pendingCard')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#loginMessage')).toHaveText(/waiting for the owner/);
    await expect(page.locator('#authScreen')).toBeVisible();
    await expect(page.locator('#appContent')).toHaveClass(/hidden/);
    await page.locator('#pendingCheckBtn').click();
    await expect(page.locator('#pendingMessage')).toHaveText(/Still waiting/);
    expect(problems.pageErrors).toEqual([]);
});

test('staff gets in without Money / Admin / Diagnostics', async ({ page, problems }) => {
    await login(page, 'staff');
    const hidden = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('.nav-menu a[data-onclick]').forEach(a => {
            const tab = a.getAttribute('data-onclick').match(/showTab\('([^']+)'/)?.[1];
            if (tab) out[tab] = a.hidden;
        });
        return out;
    });
    expect(hidden).toMatchObject({ money: true, insights: true, statements: true, admin: true, diagnostics: true, billing: false });
    expect(problems.pageErrors).toEqual([]);
});
