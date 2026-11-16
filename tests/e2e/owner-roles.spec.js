/**
 * Several owners, never none (docs/role-permissions.md, "Owners"): in Settings › Team the owner picks
 * Member / Manager / Owner; making someone owner asks first; the only owner cannot step down; an owner
 * demotes another owner. Each change saves the profile and settings/team.ownerUids together (the rules
 * refuse one without the other) and writes CHANGE_USER_ROLE.
 */
const { test, expect, login, showTab, expectToast } = require('./support/app');
const { USERS, getDoc, listDocs } = require('./support/emulator');

const uidOf = async (role) => (await listDocs('dev_users')).find(u => u.email === USERS[role].email)._id;
const row = (page, name) => page.locator('#adminActiveUsers .admin-user', { hasText: name });

async function pickRole(page, name, label, rowText = name) {
    await row(page, rowText).getByRole('button', { name: 'Edit role' }).click();
    await expect(page.locator('#modalMessage')).toContainText(`Role for ${name}`);
    await page.locator('#modalFooter [data-custom]', { hasText: new RegExp(`^${label}$`) }).click();
}

test('the owner makes a manager owner after a confirmation, cannot step down alone, and demotes the other owner', async ({ page, problems }) => {
    const ownerUid = await uidOf('owner');
    const managerUid = await uidOf('manager');
    await login(page, 'owner');
    await showTab(page, 'settings-team');
    await page.click('#teamShowPeople');
    await expect(row(page, 'Manager One')).toBeVisible({ timeout: 30000 });

    // The only owner: stepping down is refused before anything is asked or written
    await pickRole(page, 'Owner', 'Manager', USERS.owner.email);
    await expectToast(page, /There must always be at least one owner/);
    expect((await getDoc('dev_users', ownerUid)).role).toBe('owner');

    // Owner for the manager: the confirmation says what it means
    await pickRole(page, 'Manager One', 'Owner');
    await expect(page.locator('#modalMessage')).toHaveText('Manager One will get full control: money, settings, people, deleting bills. Make owner?');
    await expect(page.locator('#modalConfirm')).toHaveText('Make owner');
    await page.click('#modalConfirm');
    await expectToast(page, /Role changed to Owner/, 30000);
    expect((await getDoc('dev_users', managerUid)).role).toBe('owner');
    expect((await getDoc('dev_settings', 'team')).ownerUids).toEqual(expect.arrayContaining([ownerUid, managerUid]));

    // Two owners: one demotes the other, with the strong confirmation; the list follows
    await expect(row(page, 'Manager One').locator('.tag')).toHaveText('Owner');
    await pickRole(page, 'Manager One', 'Manager');
    await expect(page.locator('#modalMessage')).toContainText('Manager One is an owner. They will lose full control');
    await page.click('#modalConfirm');
    await expectToast(page, /Role changed to Manager/, 30000);
    expect((await getDoc('dev_users', managerUid)).role).toBe('manager');
    expect((await getDoc('dev_settings', 'team')).ownerUids).toEqual([ownerUid]);

    const changes = (await listDocs('dev_auditLogs'))
        .filter(a => a.action === 'CHANGE_USER_ROLE' && a.details?.targetUserId === managerUid)
        .map(a => [a.userId, a.details.from, a.details.to]);
    expect(changes).toEqual(expect.arrayContaining([[ownerUid, 'manager', 'owner'], [ownerUid, 'owner', 'manager']]));
    expect(problems.pageErrors).toEqual([]);
});

test('a manager has no Admin or Team, so never the owner choice', async ({ page, problems }) => {
    await login(page, 'manager');
    await page.evaluate(() => window.app.nav.showTab('admin'));
    await expect(page.locator('#adminActiveUsers .admin-user')).toHaveCount(0);
    await page.evaluate(() => window.app.nav.showTab('settings-team'));
    await expect(page.locator('#adminActiveUsers .admin-user')).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});
