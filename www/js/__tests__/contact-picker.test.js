/**
 * Contact button on Billing / Wholesale (#495): Android app plugin with permission on first use,
 * the browser Contact Picker API, and a friendly message (button stays) where neither exists.
 */
jest.mock('../ui/ui-manager.js', () => ({ UIManager: { showToast: jest.fn() } }));

import { UIManager } from '../ui/ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { contactLabel, contactPickerKind, firstMobile, normalisePhone, resetContactPickerState } from '../utils/contact-picker.js';
import { setLang } from '../i18n/index.js';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

const KEYS = ['msg.common.contact_picker_not_supported', 'msg.common.contact_picker_denied', 'msg.common.contact_picker_failed'];

const nativePlugin = (over = {}) => ({
    checkPermissions: jest.fn().mockResolvedValue({ contacts: 'prompt' }),
    requestPermissions: jest.fn().mockResolvedValue({ contacts: 'granted' }),
    pickContact: jest.fn().mockResolvedValue({
        contact: { contactId: '7', name: { display: 'Ram Lal' }, phones: [{ number: '+91 98765 43210' }, { number: '0' }] },
    }),
    ...over,
});
const installNative = (plugin) => {
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => !!plugin && n === 'Contacts', Plugins: plugin ? { Contacts: plugin } : {} };
};
const installWeb = (select) => {
    navigator.contacts = { select };
    window.ContactsManager = function ContactsManager() {};
};
const input = () => /** @type {HTMLInputElement} */ (document.getElementById('n'));
const lastToast = () => UIManager.showToast.mock.calls.at(-1);

beforeEach(async () => {
    document.body.className = '';
    document.body.innerHTML = '<input id="n"><button id="other"></button>';
    UIManager.showToast.mockClear();
    resetContactPickerState();
    await setLang('en');
});
afterEach(() => {
    delete window.Capacitor;
    delete window.ContactsManager;
    delete navigator.contacts;
    jest.restoreAllMocks();
});

describe('Android app (native plugin)', () => {
    test('asks for the permission on first use, then fills "Name - Number" with the first mobile, normalised', async () => {
        const plugin = nativePlugin();
        installNative(plugin);
        installWeb(jest.fn());
        const seen = jest.fn();
        input().addEventListener('input', seen);
        const res = await Helpers.pickContact('n');
        expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
        expect(plugin.pickContact).toHaveBeenCalledWith({ projection: { name: true, phones: true } });
        expect(navigator.contacts.select).not.toHaveBeenCalled();
        expect(input().value).toBe('Ram Lal - 9876543210');
        expect(seen).toHaveBeenCalled();
        expect(res).toEqual({ name: 'Ram Lal', phone: '9876543210' });
        expect(UIManager.showToast).not.toHaveBeenCalled();
    });

    test('already granted: no prompt; the name falls back to given + family', async () => {
        const plugin = nativePlugin({
            checkPermissions: jest.fn().mockResolvedValue({ contacts: 'granted' }),
            pickContact: jest.fn().mockResolvedValue({ contact: { name: { given: 'Sita', family: 'Devi' }, phones: [] } }),
        });
        installNative(plugin);
        expect(await Helpers.pickContact('n')).toEqual({ name: 'Sita Devi', phone: '' });
        expect(plugin.requestPermissions).not.toHaveBeenCalled();
    });

    test('denied: a clear message (en and hi) once, and the next tap does not ask again', async () => {
        const plugin = nativePlugin({ requestPermissions: jest.fn().mockResolvedValue({ contacts: 'denied' }) });
        installNative(plugin);
        expect(await Helpers.pickContact('n')).toBeNull();
        expect(plugin.pickContact).not.toHaveBeenCalled();
        expect(lastToast()[0]).toBe(en['msg.common.contact_picker_denied']);
        expect(lastToast()[1]).toBe('error');

        await setLang('hi');
        await Helpers.pickContact('n');
        expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
        expect(lastToast()[0]).toBe(hi['msg.common.contact_picker_denied']);
    });

    test('"don\'t ask again" (denied) never prompts; allowed later in Settings works', async () => {
        const plugin = nativePlugin({ checkPermissions: jest.fn().mockResolvedValue({ contacts: 'denied' }) });
        installNative(plugin);
        await Helpers.pickContact('n');
        expect(plugin.requestPermissions).not.toHaveBeenCalled();
        expect(lastToast()[0]).toBe(en['msg.common.contact_picker_denied']);

        plugin.checkPermissions.mockResolvedValue({ contacts: 'granted' });
        await Helpers.pickContact('n');
        expect(input().value).toBe('Ram Lal - 9876543210');
    });

    test('cancel is silent (rejected with a cancel message, or no contact)', async () => {
        const plugin = nativePlugin({ checkPermissions: jest.fn().mockResolvedValue({ contacts: 'granted' }) });
        installNative(plugin);
        plugin.pickContact.mockRejectedValueOnce(new Error('User cancelled'));
        expect(await Helpers.pickContact('n')).toBeNull();
        plugin.pickContact.mockResolvedValueOnce({});
        expect(await Helpers.pickContact('n')).toBeNull();
        expect(UIManager.showToast).not.toHaveBeenCalled();
        expect(input().value).toBe('');
    });

    test('a native failure shows a toast instead of only the console', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const plugin = nativePlugin({ pickContact: jest.fn().mockRejectedValue(new Error('Contact not found.')) });
        installNative(plugin);
        await Helpers.pickContact('n');
        expect(lastToast()[0]).toBe(en['msg.common.contact_picker_failed']);
        expect(console.error).toHaveBeenCalled();
    });

    test('app without the plugin (an older APK shell) does not crash: friendly message', async () => {
        installNative(null);
        expect(contactPickerKind(window)).toBeNull();
        await Helpers.pickContact('n');
        expect(lastToast()[0]).toBe(en['msg.common.contact_picker_not_supported']);
    });
});

describe('browser (Contact Picker API)', () => {
    test('fills "Name - Number" with the first mobile number', async () => {
        installWeb(jest.fn().mockResolvedValue([{ name: ['Asha'], tel: ['022 2345 6789', '+91 90000-00001', '9000000002'] }]));
        expect(contactPickerKind(window)).toBe('web');
        const changed = jest.fn();
        input().addEventListener('change', changed);
        expect(await Helpers.pickContact('n')).toEqual({ name: 'Asha', phone: '9000000001' });
        expect(navigator.contacts.select).toHaveBeenCalledWith(['name', 'tel'], { multiple: false });
        expect(input().value).toBe('Asha - 9000000001');
        expect(changed).toHaveBeenCalled();
    });

    test('no number: the name alone; no name: the number alone', async () => {
        const select = jest.fn().mockResolvedValueOnce([{ name: ['Asha'], tel: [] }]).mockResolvedValueOnce([{ name: [], tel: ['098765 43210'] }]);
        installWeb(select);
        await Helpers.pickContact('n');
        expect(input().value).toBe('Asha');
        await Helpers.pickContact('n');
        expect(input().value).toBe('9876543210');
    });

    test('closing the picker is silent; a SecurityError shows a toast', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const select = jest.fn().mockResolvedValueOnce([]);
        installWeb(select);
        await Helpers.pickContact('n');
        expect(UIManager.showToast).not.toHaveBeenCalled();
        select.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'SecurityError' }));
        await Helpers.pickContact('n');
        expect(lastToast()[0]).toBe(en['msg.common.contact_picker_failed']);
    });
});

describe('unsupported (desktop, iOS, Firefox)', () => {
    test('the button stays; the tap shows a friendly message and focuses the name field', async () => {
        document.body.innerHTML = '<input id="n"><button data-perm="contacts" id="btn"></button>';
        document.getElementById('btn').focus();
        expect(contactPickerKind(window)).toBeNull();
        expect(await Helpers.pickContact('n')).toBeNull();
        expect(lastToast()[0]).toBe(en['msg.common.contact_picker_not_supported']);
        expect(lastToast()[1]).toBe('info');
        expect(document.activeElement).toBe(input());
        expect(document.getElementById('btn').hidden).toBe(false);
    });
});

describe('role gating (Roles & access › Phone contacts)', () => {
    test('no-perm-contacts: neither picker nor message runs', async () => {
        document.body.className = 'no-perm-contacts';
        const plugin = nativePlugin();
        installNative(plugin);
        await Helpers.pickContact('n');
        delete window.Capacitor;
        await Helpers.pickContact('n');
        expect(plugin.checkPermissions).not.toHaveBeenCalled();
        expect(plugin.pickContact).not.toHaveBeenCalled();
        expect(UIManager.showToast).not.toHaveBeenCalled();
    });
});

test('every message exists in English and Hindi', () => {
    for (const k of KEYS) {
        expect(en[k]).toBeTruthy();
        expect(hi[k]).toBeTruthy();
        expect(hi[k]).not.toBe(en[k]);
    }
});

describe('"Name - Number" (owner, v730)', () => {
    test('Indian numbers become 10 digits; other numbers keep their digits', () => {
        expect(normalisePhone('+91 98765-43210')).toBe('9876543210');
        expect(normalisePhone('91 98765 43210')).toBe('9876543210');
        expect(normalisePhone('0 (98765) 43210')).toBe('9876543210');
        expect(normalisePhone('98765.43210')).toBe('9876543210');
        expect(normalisePhone('+44 20 7946 0958')).toBe('+442079460958');
        expect(normalisePhone('12345')).toBe('12345');
        expect(normalisePhone('')).toBe('');
    });

    test('the first number marked mobile, else the first Indian mobile, else the first number', () => {
        expect(firstMobile([{ type: 'home', number: '9111111111' }, { type: 'mobile', number: '+91 98765 43210' }])).toBe('9876543210');
        expect(firstMobile(['022 2345 6789', '98765 43210', '9000000002'])).toBe('9876543210');
        expect(firstMobile(['022 2345 6789'])).toBe('2223456789');
        expect(firstMobile([])).toBe('');
    });

    test('Android: a contact with no name fills the number alone', async () => {
        installNative(nativePlugin({
            checkPermissions: jest.fn().mockResolvedValue({ contacts: 'granted' }),
            pickContact: jest.fn().mockResolvedValue({ contact: { name: {}, phones: [{ type: 'mobile', number: '+91 98765-43210' }] } }),
        }));
        await Helpers.pickContact('n');
        expect(input().value).toBe('9876543210');
    });

    test('the separator is a plain " - "', () => {
        expect(contactLabel('Ramesh', '9876543210')).toBe('Ramesh - 9876543210');
        expect(contactLabel('Ramesh', '')).toBe('Ramesh');
        expect(contactLabel('', '9876543210')).toBe('9876543210');
    });
});
