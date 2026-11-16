/**
 * @fileoverview Photo of weights (#374): the Billing button and the owner's switch. The button shows
 * only when the owner has switched the feature on for the shop (settings/app.photoWeights, off by
 * default) and this device can pick a photo. Everyone may use it (owner, manager, members). The
 * camera opens from the tap itself (a file input needs the user's gesture); the reading code loads
 * with import() once a photo is taken. Purchase only for now.
 * @module ui/photo-weights
 */

import { AppState } from '../utils/state.js';
import { UIManager } from './ui-manager.js';
import { t } from '../i18n/index.js';

/** Forms that have the button; Retail and Wholesale can be added here later. */
export const PHOTO_FORMS = Object.freeze({
    purchase: { input: 'photoWeightsInput', weightInput: 'newWeight' }
});

/** settings/app.photoWeights as read at start-up (kept here like the printer's shared receipt). */
let sharedSetting = { enabled: false };

/** Does the owner's shop-wide switch say on? */
export function photoWeightsOn(setting = sharedSetting) {
    return setting?.enabled === true;
}

/** Can this device pick or take a photo (a file input)? */
export function canPickPhoto(doc = document) {
    try {
        const input = doc.createElement('input');
        input.type = 'file';
        return input.type === 'file' && !input.disabled;
    } catch {
        return false;
    }
}

/** settings/app.photoWeights as stored (only `enabled` is used). */
export function photoWeightsSettings(raw) {
    return { enabled: raw?.enabled === true };
}

const focusWeight = (mode) => document.getElementById(PHOTO_FORMS[mode]?.weightInput)?.focus();

export const PhotoWeights = {
    /** The shop's switch from settings/app (start-up read, or the owner's save). */
    setShared(raw) {
        sharedSetting = photoWeightsSettings(raw);
        this.apply();
    },

    shared() {
        return { ...sharedSetting };
    },

    /** Shows or hides the Billing buttons and sets the Settings switch. */
    apply() {
        const show = photoWeightsOn() && canPickPhoto();
        document.querySelectorAll('[data-photo-weights]').forEach(b => { b.hidden = !show; });
        const box = document.getElementById('settingPhotoWeights');
        if (box) {
            box.checked = photoWeightsOn();
            box.disabled = AppState.userRole !== 'owner';
        }
        const ownerOnly = document.getElementById('photoWeightsOwnerOnly');
        if (ownerOnly) ownerOnly.hidden = AppState.userRole === 'owner';
    },

    /**
     * The button: opens the camera (or the file picker). Offline it says so and puts the
     * cursor in the weight box instead.
     * @param {'purchase'} mode
     * @returns {boolean} true when the camera was opened
     */
    pick(mode) {
        const form = PHOTO_FORMS[mode];
        if (!form || !photoWeightsOn()) return false;
        if (navigator.onLine === false) {
            UIManager.showToast(t('msg.photo_weights.offline'), 4000);
            focusWeight(mode);
            return false;
        }
        const input = document.getElementById(form.input);
        if (!input) return false;
        input.value = '';
        input.click();
        return true;
    },

    /**
     * The photo was taken: read it and show the check sheet.
     * @param {HTMLInputElement} input
     * @param {'purchase'} [mode]
     * @returns {Promise<boolean>} true when weights were added to the form
     */
    picked(input, mode = 'purchase') {
        const file = input?.files?.[0];
        // The full-size photo is not kept on the page
        if (input) input.value = '';
        if (!file || !PHOTO_FORMS[mode]) return Promise.resolve(false);
        return import('../modules/photo-weights.js').then(m => m.PhotoWeightsFlow.read(file, mode));
    }
};
