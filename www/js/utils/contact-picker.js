// @ts-check
/**
 * Pick one contact from the phone (#495).
 * Android app: @capacitor-community/contacts (`Capacitor.Plugins.Contacts`), contacts permission
 * asked on first use. Browser: the Contact Picker API (Chrome on Android). Anything else: unsupported.
 * @module utils/contact-picker
 */

/** @typedef {{ status: 'picked', name: string, phone: string } | { status: 'cancelled' | 'denied' | 'unsupported' | 'error' }} PickResult */

let deniedThisSession = false;

/** Test hook. */
export function resetContactPickerState() {
    deniedThisSession = false;
}

/** @param {any} win */
function nativePlugin(win) {
    const cap = win?.Capacitor;
    if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.('Contacts')) return null;
    return cap.Plugins?.Contacts || null;
}

/** @param {any} win */
function webPicker(win) {
    const nav = win?.navigator;
    return nav && 'contacts' in nav && 'ContactsManager' in win && typeof nav.contacts?.select === 'function' ? nav.contacts : null;
}

/** @param {any} win @returns {'native' | 'web' | null} */
export function contactPickerKind(win = globalThis) {
    if (nativePlugin(win)) return 'native';
    if (webPicker(win)) return 'web';
    return null;
}

/** @param {any} v */
const firstText = (v) => String((Array.isArray(v) ? v.find((x) => x && String(x).trim()) : v) || '').trim();

/**
 * A phone number as the bill shows it: spaces, dashes, brackets and dots left out, and an Indian
 * number's leading +91 / 91 / 0 dropped when 10 digits are left ("+91 98765-43210" → "9876543210").
 * Anything else keeps its digits (and a leading +) as given.
 * @param {*} raw
 * @returns {string}
 */
export function normalisePhone(raw) {
    const s = String(raw ?? '').trim().replace(/[\s\-().]/g, '');
    const digits = s.replace(/^\+/, '');
    if (/^\d+$/.test(digits)) {
        if (digits.length === 10) return digits;
        for (const p of ['91', '0']) if (digits.length === p.length + 10 && digits.startsWith(p)) return digits.slice(p.length);
    }
    return s;
}

/** @param {string} n */
const isIndianMobile = (n) => /^[6-9]\d{9}$/.test(n);

/**
 * The first mobile number of a contact, normalised: the first marked mobile (Android), else the
 * first that is an Indian mobile number, else the first number at all; '' when there is none.
 * @param {Array<string | { number?: string, type?: string }>} phones
 * @returns {string}
 */
export function firstMobile(phones) {
    const all = (phones || []).map((p) => (typeof p === 'string' ? { number: p } : p || {}))
        .map((p) => ({ type: String(p.type || '').toLowerCase(), number: normalisePhone(p.number) }))
        .filter((p) => p.number);
    const marked = all.filter((p) => p.type === 'mobile');
    const pool = marked.length ? marked : all;
    return (pool.find((p) => isIndianMobile(p.number)) || pool[0])?.number || '';
}

/**
 * What a picked contact puts in the name field: "Name - Number", the name alone without a
 * number, the number alone without a name.
 * @param {string} name
 * @param {string} phone
 * @returns {string}
 */
export function contactLabel(name, phone) {
    const n = String(name || '').trim();
    const p = String(phone || '').trim();
    return n && p ? `${n} - ${p}` : n || p;
}

/** @param {any} err */
const isCancel = (err) => /cancel/i.test(String(err?.message || err || ''));
/** @param {any} err */
const isPermissionError = (err) => /permission/i.test(String(err?.message || err || ''));

/** @param {any} plugin @returns {Promise<boolean>} */
async function ensurePermission(plugin) {
    const perm = await plugin.checkPermissions?.();
    if (perm?.contacts === 'granted') {
        deniedThisSession = false;
        return true;
    }
    // Asked once already (this session, or Android's "don't ask again"): point to Settings instead.
    if (deniedThisSession || perm?.contacts === 'denied') return false;
    const asked = await plugin.requestPermissions?.();
    if (asked?.contacts === 'granted') return true;
    deniedThisSession = true;
    return false;
}

/** @param {any} plugin @returns {Promise<PickResult>} */
async function pickNative(plugin) {
    if (!(await ensurePermission(plugin))) return { status: 'denied' };
    const res = await plugin.pickContact({ projection: { name: true, phones: true } });
    const c = res?.contact;
    if (!c) return { status: 'cancelled' };
    const n = c.name || {};
    const name = firstText(n.display) || [n.given, n.middle, n.family].map(firstText).filter(Boolean).join(' ');
    const phone = firstMobile(c.phones || []);
    return { status: 'picked', name, phone };
}

/** @param {any} contacts @returns {Promise<PickResult>} */
async function pickWeb(contacts) {
    const list = await contacts.select(['name', 'tel'], { multiple: false });
    const c = list?.[0];
    if (!c) return { status: 'cancelled' };
    return { status: 'picked', name: firstText(c.name), phone: firstMobile(Array.isArray(c.tel) ? c.tel : [c.tel]) };
}

/**
 * @param {any} [win]
 * @returns {Promise<PickResult>}
 */
export async function pickPhoneContact(win = globalThis) {
    const plugin = nativePlugin(win);
    const web = plugin ? null : webPicker(win);
    if (!plugin && !web) return { status: 'unsupported' };
    try {
        return plugin ? await pickNative(plugin) : await pickWeb(web);
    } catch (err) {
        const name = /** @type {any} */ (err)?.name;
        if (isCancel(err) || name === 'AbortError' || name === 'InvalidStateError') return { status: 'cancelled' };
        if (plugin && isPermissionError(err)) {
            deniedThisSession = true;
            return { status: 'denied' };
        }
        console.error('Pick contact error:', err);
        return { status: 'error' };
    }
}
