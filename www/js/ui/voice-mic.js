/**
 * @fileoverview Voice billing switch and mic buttons (#81). Off by default and kept
 * per device; the mic buttons show only when it is on and this device has a speech
 * engine. The speech code loads with import() on the first tap.
 * @module ui/voice-mic
 */

import { safeSetItem } from '../utils/storage-full.js';
import { UIManager } from './ui-manager.js';
import { t } from '../i18n/index.js';

export const VOICE_KEY = 'aadhat.voiceBilling';
/** A short tone after each listen (#131); off unless switched on, per device. */
export const BEEP_KEY = 'aadhat.voiceBeep';
/** A press shorter than this is a tap: listen once, to the first pause. */
export const HOLD_MS = 350;
/** Released this far (px) outside the mic, a hold is cancelled ("slide away to cancel"). */
export const SLIDE_CANCEL_PX = 48;

/** Voice is on but this device has no speech engine: say so (the mic stays, #498). */
function noEngine() {
    UIManager.showToast(t('msg.voice.unavailable_here'), 5000);
    return false;
}

/** @type {?{btn: HTMLElement, mode: string, pointerId: number, t0: number, released: boolean, cancel: boolean, quick: boolean, session: any}} */
let hold = null;
let lastPointerAt = 0;
let bound = false;

/**
 * Hold-to-talk on every `[data-voice-hold]` mic (#498), with pointer events (touch, pen, mouse;
 * the Android WebView and Chrome): press and hold to listen, release to use it; a quick tap
 * listens once; released off the button or a cancelled press drops it. A key or TalkBack
 * (a click with no press) listens once. No text selection or long-press menu on the mic.
 */
export function bindHold(doc = typeof document === 'undefined' ? null : document) {
    if (bound || !doc) return;
    bound = true;
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onCancel, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('contextmenu', (e) => {
        if (/** @type {HTMLElement} */ (e.target)?.closest?.('[data-voice-hold]')) e.preventDefault();
    }, true);
}

function onDown(e) {
    const btn = /** @type {?HTMLElement} */ (e.target?.closest?.('[data-voice-hold]'));
    if (!btn || btn.hidden || btn.disabled || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    lastPointerAt = Date.now();
    if (hold || !VoiceMic.isOn()) return;
    const engine = voiceEngine();
    if (!engine) {
        noEngine();
        return;
    }
    try { btn.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
    const mode = btn.dataset.voiceHold === 'sale' ? 'sale' : 'purchase';
    const h = { btn, mode, pointerId: e.pointerId, t0: Date.now(), released: false, cancel: false, quick: false, session: null };
    hold = h;
    import('../modules/voice-billing.js')
        .then(m => m.VoiceBilling.beginHold(mode, engine, h))
        .catch(() => {})
        .finally(() => { if (hold === h) hold = null; });
}

function release(e, cancel) {
    const h = hold;
    if (!h || (e.pointerId !== undefined && h.pointerId !== undefined && e.pointerId !== h.pointerId)) return;
    lastPointerAt = Date.now();
    hold = null;
    h.released = true;
    if (cancel) h.cancel = true;
    else {
        const r = h.btn.getBoundingClientRect?.();
        const off = r && (r.width || r.height) && (e.clientX < r.left - SLIDE_CANCEL_PX || e.clientX > r.right + SLIDE_CANCEL_PX
            || e.clientY < r.top - SLIDE_CANCEL_PX || e.clientY > r.bottom + SLIDE_CANCEL_PX);
        h.cancel = !!off;
        h.quick = Date.now() - h.t0 < HOLD_MS;
    }
    try { h.btn.releasePointerCapture?.(h.pointerId); } catch { /* already released */ }
    if (h.session) import('../modules/voice-billing.js').then(m => m.VoiceBilling.endHold(h));
}

function onUp(e) {
    release(e, false);
}

function onCancel(e) {
    release(e, true);
}

function onClick(e) {
    const btn = /** @type {?HTMLElement} */ (e.target?.closest?.('[data-voice-hold]'));
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    // The click after a press was handled by the press
    if (Date.now() - lastPointerAt < 1000) return;
    VoiceMic.start(btn.dataset.voiceHold === 'sale' ? 'sale' : 'purchase');
}

/** For tests: the hold being made. */
export const currentHold = () => hold;

/**
 * The speech engine this device can use: the Android app's own recogniser (native
 * plugin), the browser's Web Speech API (the Android WebView has none), or null.
 * A Permissions-Policy that blocks the microphone counts as none.
 * @param {Window} [win]
 * @returns {'native'|'web'|null}
 */
export function voiceEngine(win = window) {
    const cap = win.Capacitor;
    if (cap?.isNativePlatform?.()) return cap.isPluginAvailable?.('SpeechRecognition') ? 'native' : null;
    if (!(win.SpeechRecognition || win.webkitSpeechRecognition)) return null;
    const policy = win.document?.permissionsPolicy || win.document?.featurePolicy;
    if (typeof policy?.allowsFeature === 'function' && !policy.allowsFeature('microphone')) return null;
    return 'web';
}

export const VoiceMic = {
    isOn() {
        try { return localStorage.getItem(VOICE_KEY) === '1'; } catch { return false; }
    },

    setOn(on) {
        safeSetItem(VOICE_KEY, on ? '1' : '0');
        this.apply();
    },

    beepOn() {
        try { return localStorage.getItem(BEEP_KEY) === '1'; } catch { return false; }
    },

    setBeep(on) {
        safeSetItem(BEEP_KEY, on ? '1' : '0');
        this.apply();
    },

    /** Settings checkbox, its "not available" note and the Billing mic buttons. */
    apply() {
        const engine = voiceEngine();
        const on = this.isOn();
        const box = document.getElementById('settingVoiceBilling');
        if (box) {
            box.checked = on;
            // It can always be switched off; on only where a speech engine exists
            box.disabled = !engine && !on;
        }
        const note = document.getElementById('voiceBillingUnavailable');
        if (note) note.hidden = !!engine;
        // Never hidden while voice is on (#498): without an engine a tap says why
        document.querySelectorAll('[data-voice-mic], .voice-strip').forEach(b => { b.hidden = !on; });
        const beep = document.getElementById('settingVoiceBeep');
        if (beep) {
            beep.checked = this.beepOn();
            beep.disabled = !on;
        }
        bindHold();
    },

    /**
     * A tap or a key on the mic: listen once.
     * @param {'purchase'|'sale'} mode
     * @returns {Promise<boolean>} true when something was put on the page
     */
    start(mode) {
        if (!this.isOn()) return Promise.resolve(false);
        const engine = voiceEngine();
        if (!engine) return Promise.resolve(noEngine());
        return import('../modules/voice-billing.js').then(m => m.VoiceBilling.listenOnce(mode, engine));
    },

    /**
     * The mic in the Supplier / Customer field (#498): say a name, pick from the closest parties.
     * @param {'purchase'|'sale'} mode
     */
    name(mode) {
        if (!this.isOn()) return Promise.resolve(false);
        const engine = voiceEngine();
        if (!engine) return Promise.resolve(noEngine());
        return import('../modules/voice-billing.js').then(m => m.VoiceBilling.listenName(mode, engine));
    },

    /** The check dialog's "Read aloud" switch (the dialog is open, so the module is loaded). */
    setReadback(on) {
        return import('../modules/voice-billing.js').then(m => m.VoiceBilling.setReadback(on));
    },

    /** The Undo button under the mic (#131): shown only after a voice change, so the module is loaded. */
    undo(mode) {
        return import('../modules/voice-billing.js').then(m => m.VoiceBilling.undoLast(mode));
    },

    /** The check dialog's Correct button and boxes (#131). */
    editLine(i) {
        return import('../modules/voice-billing.js').then(m => m.VoiceBilling.editLine(i));
    },

    lineChanged(i) {
        return import('../modules/voice-billing.js').then(m => m.VoiceBilling.lineChanged(i));
    }
};
