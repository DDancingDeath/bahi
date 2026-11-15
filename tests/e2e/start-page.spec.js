/**
 * Start page per role (docs/role-permissions.md, "Start page"): the owner opens on Today, a
 * manager and a member on Billing; a launch link (`#route`, home-screen shortcut) goes where it
 * points; a reload keeps the page of that browser tab, a fresh launch opens the role's page.
 */
const { test, expect, login, openApp, isReady, expectToast } = require('./support/app');
const { USERS, PASSWORD } = require('./support/emulator');

async function signIn(page, role, search) {
    await openApp(page, search);
    await page.fill('#loginEmail', USERS[role].email);
    await page.fill('#loginPassword', PASSWORD);
    await page.click('#loginForm button[type=submit]');
    await page.waitForFunction(isReady, null, { timeout: 60000 });
}

const activeTab = (page) => page.evaluate(() => document.querySelector('.tab.active')?.id || null);

for (const [role, tab] of [['owner', 'day'], ['manager', 'billing'], ['staff', 'billing']]) {
    test(`${role} opens on ${tab === 'day' ? 'Today' : 'Billing'} after sign-in`, async ({ page, problems }) => {
        await login(page, role);
        await expect(page.locator(`#${tab}.tab.active`)).toBeVisible();
        expect(await page.evaluate(() => history.state?.happaTab)).toBe(tab);
        expect(problems.pageErrors).toEqual([]);
    });
}

test('a #route launch link opens that page instead of the owner\'s Today, once', async ({ page, problems }) => {
    await signIn(page, 'owner', '?emulator=1#history');
    await expect(page.locator('#history.tab.active')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    expect(problems.pageErrors).toEqual([]);
});

test('a Settings deep link opens its group for a member', async ({ page, problems }) => {
    await signIn(page, 'staff', '?emulator=1#settings-printing');
    await expect(page.locator('#settings.tab.active')).toBeVisible();
    await expect(page.locator('#settingsPrinting')).toBeVisible();
    expect(problems.pageErrors).toEqual([]);
});

test('a launch link to a page the role may not open says so and falls back', async ({ page, problems }) => {
    await signIn(page, 'staff', '?emulator=1#admin');
    await expectToast(page, /only for the owner or manager/);
    expect(await activeTab(page)).not.toBe('admin');
    expect(['billing', 'day']).toContain(await activeTab(page));
    expect(problems.pageErrors).toEqual([]);
});

test('a reload keeps the page (Billing mid-bill); a fresh launch opens the role page', async ({ page, problems }) => {
    await login(page, 'owner');
    await expect(page.locator('#day.tab.active')).toBeVisible();
    await page.evaluate(() => window.app.nav.showTab('billing'));
    await expect(page.locator('#billing.tab.active')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(isReady, null, { timeout: 60000 });
    expect(await activeTab(page)).toBe('billing');
    expect(problems.pageErrors).toEqual([]);

    // A new launch (the same signed-in browser, a new window) starts on the owner's Today
    const context = page.context();
    await page.close();
    const fresh = await context.newPage();
    const errors = [];
    fresh.on('pageerror', e => errors.push(String(e.message || e)));
    await fresh.goto('/?emulator=1', { waitUntil: 'domcontentloaded' });
    await fresh.waitForFunction(isReady, null, { timeout: 60000 });
    expect(await activeTab(fresh)).toBe('day');
    expect(errors).toEqual([]);
});
