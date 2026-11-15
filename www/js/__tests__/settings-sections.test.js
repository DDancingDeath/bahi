/**
 * Settings groups: a short main list for everyone; Aadhat (internal 'shop') and
 * Rentals only for their owner/manager, Team only for the owner; each group is a
 * sub-page whose Back (and the back gesture) returns to the list; old routes and
 * deep links still land on the right group; the business is called Aadhat / आढ़त.
 */
jest.mock('../ui/ui-manager.js', () => ({ UIManager: { showToast: jest.fn(), hapticFeedback: jest.fn(), showModal: jest.fn() } }));

const fs = require('fs');
const path = require('path');
import { settingsView, shopRoleOf, rentRoleOf, groupOf, shownGroup, SETTINGS_GROUPS } from '../utils/settings-sections.js';
import { SettingsManager } from '../modules/settings.js';
import { BusinessSwitcher } from '../ui/business-switcher.js';
import { NavigationManager, resolveRoute } from '../ui/navigation.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AppState } from '../utils/state.js';
import { AuditService } from '../services/audit.js';
import { ThemeManager } from '../ui/theme.js';
import { t, setLang, resetLangForTests, applyTranslations } from '../i18n/index.js';

const TEMPLATES = path.join(__dirname, '..', '..', 'templates');
const html = (f) => fs.readFileSync(path.join(TEMPLATES, f), 'utf8');
const shown = (id) => !document.getElementById(id).hidden;

describe('settingsView (pure)', () => {
    test('roles per business', () => {
        expect([shopRoleOf('owner'), shopRoleOf('manager'), shopRoleOf('staff'), shopRoleOf('none')]).toEqual(['owner', 'manager', 'member', null]);
        expect(rentRoleOf('owner', null)).toBe('owner');
        expect(rentRoleOf('staff', 'manager')).toBe('manager');
        expect(rentRoleOf('manager', 'owner')).toBeNull();
    });

    const visible = (p) => SETTINGS_GROUPS.filter(g => settingsView(p)[g].visible);
    test.each([
        ['staff', null, undefined, ['appearance', 'printing', 'billing', 'help']],
        ['staff', 'member', undefined, ['appearance', 'printing', 'billing', 'help']],
        ['staff', 'manager', undefined, ['appearance', 'printing', 'billing', 'rentals', 'help']],
        ['manager', null, undefined, ['appearance', 'printing', 'billing', 'shop', 'help']],
        ['manager', null, { manager: { shopSettings: true } }, ['appearance', 'printing', 'billing', 'shop', 'help']],
        ['manager', 'manager', undefined, ['appearance', 'printing', 'billing', 'shop', 'rentals', 'help']],
        ['owner', null, undefined, ['appearance', 'printing', 'billing', 'shop', 'rentals', 'team', 'help']],
        ['none', 'manager', undefined, ['appearance', 'printing', 'billing', 'rentals', 'help']]
    ])('%s / rent %s / access %j sees %j', (userRole, rentRole, roleAccess, groups) => {
        expect(visible({ userRole, rentRole, roleAccess })).toEqual(groups);
    });

    test('routes: groups, old sections, and groups the role may not see', () => {
        expect(['appearance', 'roles', 'shop', 'common', null, 'x'].map(groupOf)).toEqual(['appearance', 'team', 'shop', null, null, null]);
        const staff = settingsView({ userRole: 'staff' });
        expect(['team', 'roles', 'shop', 'rentals', 'billing'].map(s => shownGroup(s, staff))).toEqual([null, null, null, null, 'billing']);
        expect(shownGroup('roles', settingsView({ userRole: 'owner' }))).toBe('team');
        expect(shownGroup('team', settingsView({ userRole: 'manager', roleAccess: { manager: { shopSettings: true } } }))).toBeNull();
    });

    test('editing: owner always; manager in Aadhat only when Roles & access allows; rentals manager edits Rentals', () => {
        expect(settingsView({ userRole: 'owner' }).shop.editable).toBe(true);
        expect(settingsView({ userRole: 'manager' }).shop.editable).toBe(false);
        expect(settingsView({ userRole: 'manager', roleAccess: { manager: { shopSettings: true } } }).shop.editable).toBe(true);
        expect(settingsView({ userRole: 'staff', roleAccess: { staff: { shopSettings: true } } }).shop.editable).toBe(false);
        expect(settingsView({ userRole: 'staff', rentRole: 'manager' }).rentals.editable).toBe(true);
        expect(settingsView({ userRole: 'staff', rentRole: 'member' }).rentals.visible).toBe(false);
        expect(settingsView({ userRole: 'manager', roleAccess: { manager: { shopSettings: true } } }).team.visible).toBe(false);
    });
});

describe('Settings page sections (jsdom)', () => {
    let mount;
    beforeEach(() => {
        document.body.innerHTML = html('settings.html');
        localStorage.clear();
        SettingsManager.group = null;
        AppState.settings = { laborRate: 6, heavyWeightThreshold: 30, shopName: 'Gupta Aadhat', upiId: 'gupta@upi' };
        AppState.printerSettings = { enabled: false };
        AppState.currentUser = { uid: 'u1', email: 'u@x' };
        AppState.userName = 'Asha';
        window.app = { printer: null };
        mount = jest.fn(async (el) => { el.innerHTML = '<p id="rentMounted">rentals</p>'; });
        jest.spyOn(BusinessSwitcher, 'current').mockReturnValue('shop');
        jest.spyOn(BusinessSwitcher, 'loadSettings').mockResolvedValue({ mount, save: jest.fn() });
        jest.spyOn(FirebaseService, 'loadAppSettings').mockImplementation(() => { throw new Error('no reads'); });
        jest.spyOn(FirebaseService, 'loadUsers').mockImplementation(() => { throw new Error('no reads'); });
    });
    afterEach(() => { jest.restoreAllMocks(); delete window.app; resetLangForTests(); });
    const as = (userRole, rentRole = null, roleAccess) => {
        AppState.userRole = userRole;
        AppState.rentRole = rentRole;
        if (roleAccess) AppState.settings.roleAccess = roleAccess;
    };

    const rows = () => [...document.querySelectorAll('[data-settings-open]')].filter(r => !r.hidden).map(r => r.getAttribute('data-settings-open'));
    const open = () => [...document.querySelectorAll('[data-settings-group]')].filter(g => !g.hidden).map(g => g.getAttribute('data-settings-group'));

    test('the main list: language, name and Log out on top, then one row per group the role may open', () => {
        as('staff');
        SettingsManager.open();
        expect(shown('settingsHome')).toBe(true);
        expect(open()).toEqual([]);
        ['languageSettingsCard', 'accountCard'].forEach(id => expect(document.getElementById(id).closest('#settingsHome')).not.toBeNull());
        expect(document.querySelector('[data-onclick="auth.logout()"]').closest('#settingsHome')).not.toBeNull();
        expect(document.getElementById('settingUserName').value).toBe('Asha');
        expect(rows()).toEqual(['appearance', 'printing', 'billing', 'help']);
        expect(BusinessSwitcher.loadSettings).not.toHaveBeenCalled();
        as('owner');
        SettingsManager.renderSections();
        expect(rows()).toEqual(['appearance', 'printing', 'billing', 'shop', 'rentals', 'team', 'help']);
    });

    test('every setting lives in its group', () => {
        const inGroup = (id) => document.getElementById(id).closest('[data-settings-group]')?.getAttribute('data-settings-group');
        expect(['settingSwipeTabs', 'themeGallery', 'settingShowHindi'].map(inGroup)).toEqual(['appearance', 'appearance', 'appearance']);
        expect(['settingBluetoothEnabled', 'bluetoothDevicesList', 'receiptSettingsCard'].map(inGroup)).toEqual(['printing', 'printing', 'printing']);
        expect(['voiceBillingCard', 'settingVoiceBeep', 'photoWeightsCard'].map(inGroup)).toEqual(['billing', 'billing', 'billing']);
        expect(['businessDetailsCard', 'upiCard', 'labourSettingsCard', 'billChecksCard', 'billNumbersCard', 'openingStockCard'].map(inGroup)).toEqual(Array(6).fill('shop'));
        expect(['roleAccessGrid', 'rolePeopleList'].map(inGroup)).toEqual(['team', 'team']);
        expect(['installAppCard', 'appVersionText', 'usageCard', 'notifSettingsCard', 'crashReportsCard'].map(inGroup)).toEqual(Array(5).fill('help'));
        expect(inGroup('settingsRentalsBody')).toBe('rentals');
    });

    test('member: a deep link to Team or Aadhat shows the list, never the group', () => {
        as('staff');
        const replace = jest.spyOn(NavigationManager, 'replaceRoute').mockImplementation(() => {});
        ['team', 'roles', 'shop', 'rentals'].forEach(section => {
            SettingsManager.open(section);
            expect(open()).toEqual([]);
            expect(shown('settingsHome')).toBe(true);
        });
        expect(replace).toHaveBeenCalledWith('settings');
        expect(SettingsManager.openGroup('team')).toBeNull();
        expect(open()).toEqual([]);
        SettingsManager.open('billing');
        expect(open()).toEqual(['billing']);
        expect(document.getElementById('settingPhotoWeights').disabled).toBe(true);
    });

    test('Aadhat-only manager: Aadhat view-only without the Roles & access switch; no Rentals or Team', () => {
        as('manager');
        SettingsManager.open('shop');
        expect(open()).toEqual(['shop']);
        expect(shown('settingsHome')).toBe(false);
        expect(rows()).toEqual(['appearance', 'printing', 'billing', 'shop', 'help']);
        expect(document.getElementById('settingBusinessName').disabled).toBe(true);
        expect(document.getElementById('settingLaborRate').disabled).toBe(true);
        expect(document.getElementById('settingCheck_cashOkRs').disabled).toBe(true);
        expect(shown('settingsShopViewOnly')).toBe(true);
        // the shop's UPI ID is shown, and changed only by those who may change shop settings (U-62)
        expect(document.getElementById('settingUpiId').value).toBe('gupta@upi');
        expect(document.getElementById('settingUpiId').disabled).toBe(true);
    });

    test('manager allowed in Roles & access edits the Aadhat settings', () => {
        as('manager', null, { manager: { shopSettings: true } });
        SettingsManager.open('shop');
        expect(document.getElementById('settingBusinessName').disabled).toBe(false);
        expect(document.getElementById('settingBusinessName').value).toBe('Gupta Aadhat');
        expect(document.getElementById('settingLaborRate').disabled).toBe(false);
        expect(shown('settingsShopViewOnly')).toBe(false);
        expect(rows()).not.toContain('team');
    });

    test('owner: Rentals loads only when its group opens, and empties when it closes', async () => {
        as('owner');
        SettingsManager.open();
        expect(BusinessSwitcher.loadSettings).not.toHaveBeenCalled();
        jest.spyOn(NavigationManager, 'noteRoute').mockImplementation(() => {});
        expect(SettingsManager.openGroup('rentals')).toBe('rentals');
        expect(NavigationManager.noteRoute).toHaveBeenCalledWith('settings-rentals');
        await new Promise(r => setTimeout(r));
        expect(open()).toEqual(['rentals']);
        expect(mount).toHaveBeenCalledWith(document.getElementById('settingsRentalsBody'), { editable: true });
        SettingsManager.showGroup(null);
        expect(document.getElementById('rentMounted')).toBeNull();
        SettingsManager.open('roles');
        expect(open()).toEqual(['team']);
    });

    test('rentals manager (Aadhat member) opens Rentals; a rentals member does not', async () => {
        as('staff', 'manager');
        SettingsManager.open('rentals');
        await new Promise(r => setTimeout(r));
        expect(open()).toEqual(['rentals']);
        expect(document.getElementById('rentMounted')).not.toBeNull();
        as('staff', 'member');
        jest.spyOn(NavigationManager, 'replaceRoute').mockImplementation(() => {});
        SettingsManager.open('rentals');
        expect(open()).toEqual([]);
    });

    test('Back returns to the list and focuses the row it came from; leaving Appearance ends a theme preview', () => {
        as('owner');
        SettingsManager.open('appearance');
        const cancel = jest.spyOn(ThemeManager, 'cancelPreview');
        ThemeManager.previewing = 'nordic';
        jest.spyOn(NavigationManager, 'noteRoute').mockImplementation(() => {});
        document.getElementById('settingsAppearanceTitle').focus();
        SettingsManager.back();
        expect(open()).toEqual([]);
        expect(shown('settingsHome')).toBe(true);
        expect(cancel).toHaveBeenCalled();
        expect(NavigationManager.noteRoute).toHaveBeenCalledWith('settings');
        expect(document.activeElement).toBe(document.querySelector('[data-settings-open="appearance"]'));
        SettingsManager.openGroup('help');
        expect(document.activeElement).toBe(document.getElementById('settingsHelpTitle'));
    });

    test('saving the business name writes settings/app and is used on bills', async () => {
        as('owner');
        SettingsManager.open();
        const save = jest.spyOn(FirebaseService, 'saveBusinessDetails').mockResolvedValue();
        const note = jest.spyOn(AuditService, 'note').mockImplementation(() => {});
        AppState.settings.shopName = 'Old Name';
        AppState.settings.businessDetails = 'Mandi road';
        document.getElementById('settingBusinessName').value = '  Sharma   Aadhat ';
        document.getElementById('settingBusinessDetails').value = 'Mandi road';
        expect(await SettingsManager.saveBusinessDetails()).toBe(true);
        expect(save).toHaveBeenCalledWith({ businessName: 'Sharma Aadhat', businessDetails: 'Mandi road', upiId: 'gupta@upi' });
        expect(document.getElementById('settingsShopSaveNote').textContent).toMatch(/^Saved for everyone at \d/);
        expect(AppState.settings.shopName).toBe('Sharma Aadhat');
        // #85: the change is audited with before → after, only the changed field
        expect(note).toHaveBeenCalledWith('SETTINGS_CHANGE', { section: 'business', changes: 'businessName: Old Name → Sharma Aadhat' });
        note.mockClear();
        expect(await SettingsManager.saveBusinessDetails()).toBe(true);
        expect(note).not.toHaveBeenCalled();
        as('manager');
        save.mockClear();
        expect(await SettingsManager.saveBusinessDetails()).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    test('bill checks are edited in Settings (moved from Admin › Configure)', async () => {
        as('owner');
        SettingsManager.open('shop');
        const save = jest.spyOn(FirebaseService, 'saveSharedCheckThresholds').mockResolvedValue();
        document.getElementById('settingCheck_cashOkRs').value = '75';
        expect(await SettingsManager.saveCheckThresholds()).toBe(true);
        expect(save.mock.calls[0][0].cashOkRs).toBe(75);
    });

    test('start-up shared read sets the business name; no name in settings/app keeps the device one', async () => {
        as('staff');
        await SettingsManager.applySharedSettings({ laborRate: 6, businessName: 'Shared', businessDetails: 'Line' });
        expect(AppState.settings).toMatchObject({ shopName: 'Shared', businessDetails: 'Line' });
        await SettingsManager.applySharedSettings({ laborRate: 6 });
        expect(AppState.settings.shopName).toBe('Shared');
    });

    test('UPI ID is shop-wide (U-62): read from settings/app; a UPI kept on one phone is shared once', async () => {
        const share = jest.spyOn(FirebaseService, 'saveShopUpi').mockResolvedValue();
        as('staff');
        await SettingsManager.applySharedSettings({ laborRate: 6 });
        expect(share).not.toHaveBeenCalled();
        as('owner');
        await SettingsManager.applySharedSettings({ laborRate: 6 });
        expect(share).toHaveBeenCalledWith('gupta@upi', { checked: false });
        share.mockClear();
        await SettingsManager.applySharedSettings({ laborRate: 6, upiId: 'shop@upi' });
        expect(AppState.settings.upiId).toBe('shop@upi');
        expect(share).not.toHaveBeenCalled();

        SettingsManager.open('shop');
        const save = jest.spyOn(FirebaseService, 'saveBusinessDetails').mockResolvedValue();
        document.getElementById('settingUpiId').value = ' new @upi ';
        expect(await SettingsManager.saveBusinessDetails()).toBe(true);
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ upiId: 'new@upi' }));
        expect(AppState.settings.upiId).toBe('new@upi');
        save.mockClear();
        document.getElementById('settingUpiId').value = 'ram traders';
        expect(await SettingsManager.saveBusinessDetails()).toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(AppState.settings.upiId).toBe('new@upi');
    });
});

describe('routes and deep links land on their group', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="settings" class="tab"></div><div id="admin" class="tab"></div><nav class="nav-menu"><a data-onclick="nav.showTab(\'settings\', event)"></a></nav>';
        window.app = { settings: { load: jest.fn() } };
        AppState.userRole = 'owner';
        jest.useFakeTimers();
    });
    afterEach(() => { jest.useRealTimers(); delete window.app; });

    test.each([
        ['settings', 'settings', null],
        ['settings-common', 'settings', null],
        ['settings-appearance', 'settings', 'appearance'],
        ['settings-printing', 'settings', 'printing'],
        ['settings-billing', 'settings', 'billing'],
        ['settings-shop', 'settings', 'shop'],
        ['settings-aadhat', 'settings', 'shop'],
        ['admin-configure', 'settings', 'shop'],
        ['settings-rentals', 'settings', 'rentals'],
        ['settings-team', 'settings', 'team'],
        ['settings-roles', 'settings', 'team'],
        ['settings-help', 'settings', 'help']
    ])('%s opens %s (%s)', (route, tab, section) => {
        expect(resolveRoute(route)).toMatchObject({ tab, section });
        NavigationManager.showTabFromNav(route);
        jest.runOnlyPendingTimers();
        expect(document.getElementById('settings').classList.contains('active')).toBe(true);
        expect(window.app.settings.load).toHaveBeenCalledWith(section);
        expect(document.querySelector('.nav-menu a').classList.contains('active')).toBe(true);
    });
});

describe('back gesture: a group returns to the Settings list', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="settings" class="tab"></div><div id="admin" class="tab"></div><div id="billing" class="tab"></div>';
        window.app = { settings: { load: jest.fn() } };
        AppState.userRole = 'owner';
        NavigationManager.currentTab = null;
        history.replaceState(null, '');
        jest.useFakeTimers();
    });
    afterEach(() => { jest.useRealTimers(); delete window.app; });

    test('a group opened from the list: one entry; back shows the list', () => {
        NavigationManager.showTab('settings');
        const start = history.length;
        NavigationManager.noteRoute('settings-printing');
        expect(history.state.happaTab).toBe('settings-printing');
        expect(history.length).toBe(start + 1);
        NavigationManager.handlePopState({ state: { happaTab: 'settings' } });
        jest.runOnlyPendingTimers();
        expect(NavigationManager.currentTab).toBe('settings');
        expect(window.app.settings.load).toHaveBeenLastCalledWith(null);
    });

    test('a deep link from another page puts the list beneath the group', () => {
        NavigationManager.showTab('admin');
        const start = history.length;
        NavigationManager.showTabFromNav('admin-configure');
        expect(history.state.happaTab).toBe('settings-shop');
        expect(history.length).toBe(start + 2);
        NavigationManager.showTabFromNav('settings-roles');
        expect(history.state.happaTab).toBe('settings-team');
        expect(history.length).toBe(start + 4);
    });

    test('Android back from a group goes back in history (to the list), not home', () => {
        NavigationManager.showTab('settings');
        NavigationManager.noteRoute('settings-help');
        const back = jest.spyOn(history, 'back').mockImplementation(() => {});
        const exitApp = jest.fn();
        NavigationManager.handleBackButton({ exitApp });
        expect(back).toHaveBeenCalled();
        expect(exitApp).not.toHaveBeenCalled();
    });

    test('the group\'s Back button uses history when the group has its entry', () => {
        NavigationManager.showTab('settings');
        NavigationManager.noteRoute('settings-billing');
        const back = jest.spyOn(history, 'back').mockImplementation(() => {});
        SettingsManager.back();
        expect(back).toHaveBeenCalled();
    });
});

describe('the business is called Aadhat (internal id stays shop)', () => {
    afterEach(() => resetLangForTests());

    test('English and Hindi labels', () => {
        setLang('en');
        expect([t('ui.biz.shop'), t('ui.settings.section_shop'), t('ui.roles.shop_role'), t('ui.rent.shop_role', { role: 'Manager' }), t('ui.role.none')])
            .toEqual(['Aadhat', 'Aadhat settings', 'Aadhat role', 'Aadhat: Manager', 'No Aadhat access']);
        expect(t('ui.settings.business_name')).toBe('Business name');
        setLang('hi');
        expect([t('ui.biz.shop'), t('ui.settings.section_shop'), t('ui.roles.shop_role'), t('ui.role.none')])
            .toEqual(['आढ़त', 'आढ़त की सेटिंग', 'आढ़त में भूमिका', 'आढ़त की पहुँच नहीं']);
        expect(t('ui.settings.business_name')).toBe('व्यापार का नाम');
    });

    test('the switcher reads Aadhat | Rentals and keeps the stored key "shop"', () => {
        document.body.innerHTML = html('navigation.html');
        setLang('en');
        applyTranslations(document);
        const btn = document.querySelector('[data-biz-btn="shop"]');
        expect(btn.textContent).toContain('Aadhat');
        expect(btn.getAttribute('data-onclick')).toContain("set('shop')");
        setLang('hi');
        applyTranslations(document);
        expect(btn.textContent).toContain('आढ़त');
    });
});
