// @ts-check
/**
 * @fileoverview The Android app's own native helpers (Capacitor.Plugins.AppShell, android/app/src/main/java/com/happa/
 * AppShellPlugin.java): system bar colours, the app's Android settings page, external links and printing. An APK built
 * before a method existed simply lacks it, so every caller checks with `shellMethod` and keeps its web behaviour.
 * @module utils/native-shell
 */

/**
 * @param {string} name
 * @param {any} [win=window]
 * @returns {?Function} the AppShell method bound to its plugin, or null on the web / an older APK
 */
export function shellMethod(name, win = window) {
    if (!win?.Capacitor?.isNativePlatform?.()) return null;
    const plugin = win.Capacitor?.Plugins?.AppShell;
    return typeof plugin?.[name] === 'function' ? plugin[name].bind(plugin) : null;
}

/**
 * `rgb()` / `rgba()` text (a computed colour) as [r, g, b, a], or null.
 * @param {string} text
 * @returns {?number[]}
 */
export function parseRgb(text) {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(String(text || '').trim());
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
}

/**
 * An opaque #rrggbb for `fg` laid over `bg` (both [r, g, b, a]).
 * @param {number[]} fg
 * @param {number[]} bg
 * @returns {string}
 */
export function toHex(fg, bg) {
    const a = Math.max(0, Math.min(1, fg[3]));
    return '#' + [0, 1, 2].map(i => Math.round(fg[i] * a + bg[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}

/**
 * True when dark bar icons are needed on this #rrggbb (relative luminance above the middle).
 * @param {string} hex
 * @returns {boolean}
 */
export function isLight(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

/**
 * Resolves a CSS colour (a token's value) to [r, g, b, a] through a canvas, which normalises any colour syntax.
 * @param {Document} doc
 * @param {string} value
 * @returns {?number[]}
 */
function resolveColour(doc, value) {
    if (!value) return null;
    const ctx = doc.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = value;
    const out = String(ctx.fillStyle);
    if (/^#[0-9a-f]{6}$/i.test(out)) return [1, 3, 5].map(i => parseInt(out.slice(i, i + 2), 16)).concat(1);
    return parseRgb(out);
}

/**
 * Colours the phone's status bar like the app bar (--bg) and its navigation bar like the tab bar (--bar-bg),
 * with dark or light icons to match, in the Android app. Called at start and on every theme / mode change.
 * @param {Document} [doc=document]
 * @param {any} [win=window]
 * @returns {Promise<void>}
 */
export async function syncSystemBars(doc = document, win = window) {
    const set = shellMethod('setSystemBars', win);
    if (!set || !doc.body) return;
    const style = getComputedStyle(doc.documentElement);
    const bg = resolveColour(doc, style.getPropertyValue('--bg').trim());
    if (!bg) return;
    const base = [bg[0], bg[1], bg[2], 1];
    const bar = resolveColour(doc, style.getPropertyValue('--bar-bg').trim()) || base;
    const top = toHex(base, base);
    const bottom = toHex(bar, base);
    try {
        await set({ top, bottom, lightTop: isLight(top), lightBottom: isLight(bottom) });
    } catch (e) {
        console.warn('System bar colours not set:', /** @type {any} */ (e)?.message || e);
    }
}

/**
 * Keeps the focused field clear of the keyboard and of a fixed Save row (Android app): the native side
 * shrinks the WebView when the keyboard opens, then the field is scrolled to the middle if it is hidden.
 * @param {any} [win=window]
 */
export function keepFocusInView(win = window) {
    if (!win?.Capacitor?.isNativePlatform?.()) return;
    const doc = win.document;
    const reveal = () => {
        const el = doc.activeElement;
        if (!el || !el.matches?.('input, textarea, select') || el.getClientRects().length === 0) return;
        let limit = win.innerHeight;
        doc.querySelectorAll('.bill-actions').forEach((/** @type {Element} */ bar) => {
            if (bar.contains(el) || bar.getClientRects().length === 0 || getComputedStyle(bar).position !== 'fixed') return;
            limit = Math.min(limit, bar.getBoundingClientRect().top);
        });
        const r = el.getBoundingClientRect();
        if (r.bottom > limit || r.top < 0) el.scrollIntoView({ block: 'center' });
    };
    let timer = 0;
    const later = (/** @type {number} */ ms) => { win.clearTimeout(timer); timer = win.setTimeout(reveal, ms); };
    win.addEventListener('resize', () => later(60));
    doc.addEventListener('focusin', () => later(350));
}

/**
 * Keeps the system bars in step with the app's theme (Android app only).
 * @param {any} [win=window]
 */
export function watchSystemBars(win = window) {
    if (!shellMethod('setSystemBars', win)) return;
    win.addEventListener('aadhat:themechange', () => { syncSystemBars(win.document, win); });
    syncSystemBars(win.document, win);
}
