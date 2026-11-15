// @ts-check
/**
 * @fileoverview Open a link outside the app (WhatsApp, UPI, browser, APK download).
 * In the Capacitor APK the AppShell plugin hands it to Android and says when no app could open it
 * (an APK without the plugin uses '_system', where a failure is silent); on the web it opens a
 * new tab and only navigates this tab when the popup was really blocked.
 * @module utils/open-external
 */
import { shellMethod } from './native-shell.js';
import { UIManager } from '../ui/ui-manager.js';
import { t } from '../i18n/index.js';

/**
 * The message when no app on the phone opened the link.
 * @param {string} url
 * @returns {string} i18n key
 */
export function notOpenedKey(url) {
    const u = String(url || '').toLowerCase();
    if (u.startsWith('upi:')) return 'msg.common.could_not_open_upi';
    if (u.startsWith('whatsapp:') || /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(u)) return 'msg.common.could_not_open_whatsapp';
    return 'msg.common.could_not_open_link';
}

/**
 * @param {string} url
 * @param {Window & {Capacitor?: any}} [win=window]
 * @returns {'system'|'tab'|'same-tab'} how the link was opened
 */
export function openExternal(url, win = window) {
    if (win.Capacitor?.isNativePlatform?.()) {
        const open = shellMethod('openUrl', win);
        if (!open) {
            win.open(url, '_system');
            return 'system';
        }
        Promise.resolve(open({ url }))
            .then((r) => { if (!r?.opened) UIManager.showToast(t(notOpenedKey(url)), 'warning'); })
            .catch(() => UIManager.showToast(t(notOpenedKey(url)), 'warning'));
        return 'system';
    }
    // Not 'noopener' as a feature: then window.open always returns null and
    // the fallback below would also navigate the app away.
    const tab = win.open(url, '_blank');
    if (tab) {
        try { tab.opener = null; } catch (_) { /* cross-origin: nothing to clear */ }
        return 'tab';
    }
    win.location.href = url;
    return 'same-tab';
}
