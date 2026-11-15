/**
 * @fileoverview The start-up screen of index.html (U-25): main.js names the step it waits
 * for, and removes the screen once the login screen or the app is drawn.
 * @module ui/boot-splash
 */

/** @param {string} text - the step, in the app language */
export function bootStep(text) {
    const root = typeof document !== 'undefined' ? document.getElementById('bootSplash') : null;
    const el = root?.querySelector('[data-boot-text]');
    if (!el) return;
    root.setAttribute('data-boot-stepped', '');
    el.textContent = text;
}

export function hideBootSplash() {
    if (typeof document === 'undefined') return;
    document.getElementById('bootSplash')?.remove();
}
