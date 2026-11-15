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
    const phone = firstText((c.phones || []).map((/** @type {any} */ p) => p?.number));
    return { status: 'picked', name, phone };
}

/** @param {any} contacts @returns {Promise<PickResult>} */
async function pickWeb(contacts) {
    const list = await contacts.select(['name', 'tel'], { multiple: false });
    const c = list?.[0];
    if (!c) return { status: 'cancelled' };
    return { status: 'picked', name: firstText(c.name), phone: firstText(c.tel) };
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
