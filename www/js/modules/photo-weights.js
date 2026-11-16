/**
 * @fileoverview Photo of weights (#374): the photo is made smaller on the phone, read by
 * firebase/photo-weights-ai.js and shown in a check sheet: the photo with a numbered box over each
 * weight, and the weights to edit, remove or add, unclear ones highlighted, crossed-out ones left
 * out. "Add N weights" only puts them in the line's bag chips (PurchaseManager.addWeights): the user
 * still picks the item and rate, adds the line and saves. Nothing is saved here and the photo is
 * kept only in memory while the sheet is open.
 * @module modules/photo-weights
 */

import { UIManager, buildSheet, openSheet, closeSheet } from '../ui/ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { t, tn } from '../i18n/index.js';
import { formatKg } from '../utils/money.js';
import { icon } from '../ui/icons.js';
import { track } from '../services/usage.js';
import { showFieldError, clearFieldError } from '../ui/bill-highlight.js';
import { confirmBagWeights } from '../ui/rate-check.js';
import { PhotoWeights, PHOTO_FORMS } from '../ui/photo-weights.js';
import { readWeightsPhoto } from '../firebase/photo-weights-ai.js';
import { PurchaseManager } from './purchase.js';
import {
    PHOTO_JPEG_QUALITY, READ_TIMEOUT_MS, fitWithin, normaliseReading, parseWeightText, photoErrorKey, reviewSummary, rotateBox
} from '../utils/photo-weights.js';
import { BAG_WEIGHT_LIMIT_KG, heavyBag } from '../utils/calc/billing.js';

/** Per form: where the weights go and the save lock that must be free. */
const TARGETS = {
    purchase: { manager: PurchaseManager, lock: 'purchase', unit: 'bag' }
};

const el = (tag, cls = '', text = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
};

const button = (cls, text, onClick) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
};

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * The photo upright as the camera meant it, at most PHOTO_MAX_SIDE px: a canvas (shown in the
 * sheet) and the JPEG sent. The full-size file is not kept.
 * @param {Blob} file
 * @returns {Promise<{canvas: HTMLCanvasElement, blob: Blob}>}
 */
export async function preparePhoto(file) {
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitWithin(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    image.close?.();
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('photo not made'))), 'image/jpeg', PHOTO_JPEG_QUALITY);
    });
    return { canvas, blob };
}

/** The photo turned so the writing is upright (the model says how far). */
function uprightCanvas(source, rotation) {
    if (!rotation) return source;
    const turned = document.createElement('canvas');
    const sideways = rotation === 90 || rotation === 270;
    turned.width = sideways ? source.height : source.width;
    turned.height = sideways ? source.width : source.height;
    const ctx = turned.getContext('2d');
    ctx.translate(turned.width / 2, turned.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    return turned;
}

export const PhotoWeightsFlow = {
    /** The open sheet's state (one at a time). */
    open: null,

    /**
     * Reads a photo and shows the check sheet.
     * @param {Blob} file
     * @param {'purchase'} mode
     * @param {{prepare?: typeof preparePhoto, read?: typeof readWeightsPhoto}} [deps] tests
     * @returns {Promise<boolean>} true when weights were added to the form
     */
    async read(file, mode, { prepare = preparePhoto, read = readWeightsPhoto } = {}) {
        if (!TARGETS[mode] || this.open) return false;
        const sheet = this.buildSheet(mode);
        const state = { mode, sheet, rows: [], crossed: [], reading: null, canvas: null, abort: new AbortController(), done: null };
        this.open = state;
        const finished = new Promise(resolve => { state.done = resolve; });
        this.showReading(state);
        if (!online()) {
            this.showError(state, 'msg.photo_weights.offline');
            return finished;
        }
        const timer = setTimeout(() => state.abort.abort(), READ_TIMEOUT_MS);
        try {
            const { canvas, blob } = await prepare(file);
            if (this.open !== state) return finished;
            const raw = await read(blob, { signal: state.abort.signal });
            if (this.open !== state) return finished;
            track('photo_weights.read');
            const reading = normaliseReading(raw);
            if (!reading.entries.length && !reading.crossedOut.length) {
                this.showError(state, 'msg.photo_weights.none', { retake: true });
                return finished;
            }
            state.reading = reading;
            state.canvas = uprightCanvas(canvas, reading.rotation);
            state.rows = reading.entries.map(e => ({ value: e.value, text: e.value === null ? '' : String(e.value), unclear: e.unclear, box: e.box && rotateBox(e.box, reading.rotation) }));
            state.crossed = reading.crossedOut.map(e => ({ value: e.value, text: e.value === null ? '' : String(e.value), unclear: e.unclear, box: e.box && rotateBox(e.box, reading.rotation) }));
            this.showReview(state);
        } catch (err) {
            if (this.open !== state) return finished;
            console.warn('Photo of weights not read:', err?.code || err?.message || err);
            const key = photoErrorKey(err, { online: online() });
            this.showError(state, key, { retake: key === 'msg.photo_weights.failed' });
        } finally {
            clearTimeout(timer);
        }
        return finished;
    },

    buildSheet(mode) {
        const parts = buildSheet({ labelId: 'photoWeightsTitle', title: t('ui.photo_weights.title'), className: 'photo-weights-sheet' });
        parts.overlay.id = 'photoWeightsSheet';
        parts.overlay.dataset.mode = mode;
        document.body.appendChild(parts.overlay);
        return parts;
    },

    /** Closes the sheet; the photo and the reading are dropped with it. */
    close(state, added = false) {
        if (!state || this.open !== state) return;
        this.open = null;
        state.abort.abort();
        closeSheet(state.sheet.overlay);
        state.sheet.overlay.remove();
        state.canvas = null;
        state.done(added);
    },

    /** Ends the sheet and puts the cursor in the weight box, to type instead. */
    typeInstead(state) {
        this.close(state);
        document.getElementById(PHOTO_FORMS[state.mode].weightInput)?.focus();
    },

    retake(state) {
        const { mode } = state;
        this.close(state);
        PhotoWeights.pick(mode);
    },

    showReading(state) {
        const { body, footer, overlay } = state.sheet;
        const p = el('p', 'pw-status', t('ui.photo_weights.reading'));
        p.setAttribute('role', 'status');
        p.setAttribute('aria-live', 'polite');
        body.replaceChildren(p);
        const cancel = button('btn btn-ghost', t('ui.modals.cancel'), () => this.close(state));
        cancel.dataset.dismiss = '';
        footer.replaceChildren(cancel);
        openSheet(overlay, { focus: cancel });
    },

    /** A clear message and the way back to typing; manual entry always stays open. */
    showError(state, key, { retake = false } = {}) {
        const { body, footer, overlay } = state.sheet;
        const note = el('p', 'notice warn', t(key));
        note.setAttribute('role', 'alert');
        note.dataset.photoError = key;
        body.replaceChildren(note);
        const type = button('btn btn-primary', t('ui.photo_weights.type_instead'), () => this.typeInstead(state));
        type.dataset.dismiss = '';
        footer.replaceChildren(...(retake ? [button('btn btn-tonal', t('ui.photo_weights.retake'), () => this.retake(state))] : []), type);
        openSheet(overlay, { focus: type });
    },

    showReview(state) {
        const { body, footer, overlay } = state.sheet;
        const photo = el('figure', 'pw-photo');
        const canvas = state.canvas;
        canvas.classList.add('pw-photo-img');
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', t('ui.photo_weights.photo_alt'));
        const boxes = el('ol', 'pw-boxes');
        boxes.setAttribute('aria-hidden', 'true');
        photo.append(canvas, boxes);

        const hint = el('p', 'notice warn pw-unclear-hint', t('ui.photo_weights.unclear_hint'));
        const list = el('ol', 'panel pw-list');
        const addRow = button('btn btn-tonal btn-block pw-add-row', '', () => {
            state.rows.push({ value: null, text: '', unclear: false, box: null, added: true });
            this.renderRows(state);
            list.querySelector('li:last-child input')?.focus();
        });
        addRow.innerHTML = `${icon('plus')}<span>${Helpers.escapeHtml(t('ui.photo_weights.add_row'))}</span>`;
        const crossedWrap = el('div', 'pw-crossed');
        const summary = el('p', 'pw-summary');
        summary.setAttribute('aria-live', 'polite');
        const checks = el('div', 'pw-checks');
        const existing = TARGETS[state.mode].manager.getWeights().length;
        const adds = el('p', 'setting-description', existing ? tn('ui.photo_weights.adds_to', existing) : '');
        adds.hidden = !existing;
        body.replaceChildren(photo, hint, list, addRow, crossedWrap, summary, checks, adds);
        state.ui = { photo: boxes, hint, list, crossedWrap, summary, checks };

        const cancel = button('btn btn-ghost', t('ui.modals.cancel'), () => this.close(state));
        cancel.dataset.dismiss = '';
        const retake = button('btn btn-tonal', t('ui.photo_weights.retake'), () => this.retake(state));
        const add = button('btn btn-primary pw-add', '', () => this.addToForm(state));
        state.ui.add = add;
        footer.replaceChildren(cancel, retake, add);
        this.renderRows(state);
        const firstUnclear = list.querySelector('.is-unclear input');
        openSheet(overlay, { focus: firstUnclear || add });
    },

    /** The weights still to add, as typed now (an empty row is skipped). */
    values(state) {
        return state.rows.map(r => (String(r.text).trim() === '' ? null : parseWeightText(String(r.text))));
    },

    renderRows(state) {
        const { list, photo, hint, crossedWrap } = state.ui;
        list.replaceChildren(...state.rows.map((row, i) => this.rowEl(state, row, i)));
        hint.hidden = !state.rows.some(r => r.unclear);
        photo.replaceChildren(...state.rows.map((row, i) => (row.box ? this.boxEl(row.box, i + 1, row.unclear) : null)).filter(Boolean));

        crossedWrap.replaceChildren();
        if (state.crossed.length) {
            crossedWrap.append(el('h4', 'pw-crossed-title', t('ui.photo_weights.crossed_title')));
            const ul = el('ul', 'panel pw-list');
            state.crossed.forEach((row, i) => {
                const li = el('li', 'row pw-row is-crossed');
                li.append(el('s', 'row-main', row.text || '?'));
                li.append(button('btn btn-tonal btn-sm', t('ui.photo_weights.use_crossed'), () => {
                    state.crossed.splice(i, 1);
                    state.rows.push({ ...row, unclear: true, restored: true });
                    this.renderRows(state);
                }));
                ul.append(li);
            });
            crossedWrap.append(ul);
        }
        this.renderSummary(state);
    },

    rowEl(state, row, i) {
        const n = i + 1;
        const li = el('li', `row pw-row${row.unclear ? ' is-unclear' : ''}`);
        li.dataset.pwRow = String(i);
        const num = el('span', 'pw-num', String(n));
        num.setAttribute('aria-hidden', 'true');
        const field = el('div', 'field pw-field');
        const adorn = el('div', 'adorn');
        const input = /** @type {HTMLInputElement} */ (el('input', 'input'));
        input.type = 'text';
        input.inputMode = 'decimal';
        input.id = `pwWeight${i}`;
        input.value = row.text;
        input.setAttribute('aria-label', t('ui.photo_weights.weight_n', { n }));
        input.addEventListener('input', () => {
            row.text = input.value;
            row.edited = true;
            clearFieldError(input.id);
            this.renderSummary(state);
            this.renderTags(li, row);
        });
        input.addEventListener('focus', () => this.highlight(state, i));
        const kg = el('span', 'adorn-post', 'kg');
        kg.setAttribute('aria-hidden', 'true');
        adorn.append(input, kg);
        field.append(adorn);
        const tags = el('span', 'pw-tags');
        const remove = button('btn btn-ghost btn-icon', '', () => {
            state.rows.splice(i, 1);
            state.removed = true;
            this.renderRows(state);
        });
        remove.innerHTML = icon('trash');
        remove.setAttribute('aria-label', t('ui.photo_weights.remove', { n }));
        li.append(num, field, tags, remove);
        this.renderTags(li, row);
        return li;
    },

    renderTags(li, row) {
        const tags = li.querySelector('.pw-tags');
        const value = String(row.text).trim() === '' ? null : parseWeightText(String(row.text));
        const out = [];
        if (row.unclear) out.push(el('span', 'tag warn', t('ui.photo_weights.unclear')));
        if (value !== null && heavyBag(value)) out.push(el('span', 'tag neg', t('ui.photo_weights.heavy', { limit: BAG_WEIGHT_LIMIT_KG })));
        tags.replaceChildren(...out);
    },

    boxEl(box, n, unclear) {
        const [y0, x0, y1, x1] = box;
        const li = el('li', `pw-box${unclear ? ' is-unclear' : ''}`);
        li.dataset.n = String(n);
        li.style.setProperty('--pw-top', `${y0 / 10}%`);
        li.style.setProperty('--pw-left', `${x0 / 10}%`);
        li.style.setProperty('--pw-h', `${(y1 - y0) / 10}%`);
        li.style.setProperty('--pw-w', `${(x1 - x0) / 10}%`);
        return li;
    },

    /** The box of the weight being edited stands out on the photo. */
    highlight(state, i) {
        state.ui.photo.querySelectorAll('.pw-box').forEach(b => b.classList.toggle('is-active', b.dataset.n === String(i + 1)));
    },

    renderSummary(state) {
        const values = this.values(state).filter(v => v !== null);
        const reading = state.reading || {};
        const s = reviewSummary(values, { writtenTotal: reading.writtenTotal, writtenCount: reading.writtenCount });
        state.ui.summary.textContent = tn('ui.photo_weights.summary', s.count, { kg: formatKg(s.total) });
        const checks = [];
        if (s.totalCheck) {
            checks.push(el('p', `notice ${s.totalCheck.ok ? 'pos' : 'warn'}`, s.totalCheck.ok
                ? t('ui.photo_weights.sheet_total_ok', { kg: formatKg(s.totalCheck.sheet) })
                : t('ui.photo_weights.sheet_total_off', { sheet: formatKg(s.totalCheck.sheet), read: formatKg(s.totalCheck.read) })));
        }
        if (s.countCheck) {
            checks.push(el('p', `notice ${s.countCheck.ok ? 'pos' : 'warn'}`, s.countCheck.ok
                ? t('ui.photo_weights.sheet_count_ok', { n: s.countCheck.sheet })
                : t('ui.photo_weights.sheet_count_off', { sheet: s.countCheck.sheet, read: s.countCheck.read })));
        }
        state.ui.checks.replaceChildren(...checks);
        state.ui.add.textContent = tn('ui.photo_weights.add_n', s.count);
        state.ui.add.disabled = s.count === 0;
    },

    /**
     * "Add N weights": every kept weight must be a number; a bag over 100 kg is asked like a typed
     * one (BF-BAGCHECK). Then the weights go into the line's chips; nothing else changes.
     */
    async addToForm(state) {
        const target = TARGETS[state.mode];
        const typed = this.values(state);
        const bad = state.rows.findIndex((r, i) => String(r.text).trim() !== '' && typed[i] === null);
        if (bad !== -1) {
            showFieldError(`pwWeight${bad}`, t('msg.photo_weights.invalid', { n: bad + 1 }));
            return false;
        }
        const list = typed.filter(v => v !== null);
        if (!list.length) {
            UIManager.showToast(t('msg.photo_weights.nothing_to_add'), 3000);
            return false;
        }
        if (Helpers.isBusy(target.lock)) {
            UIManager.showToast(t('msg.photo_weights.finish_saving'), 4000);
            return false;
        }
        const rowOf = state.rows.map((r, i) => i).filter(i => typed[i] !== null);
        const bags = await confirmBagWeights(list, target.unit);
        if (this.open !== state) return false;
        if (!bags.ok) {
            const input = document.getElementById(`pwWeight${rowOf[bags.index]}`);
            input?.focus();
            input?.select?.();
            return false;
        }
        const n = target.manager.addWeights(list, bags.records);
        const original = (state.reading?.entries || []).map(e => e.value);
        const edited = state.removed || state.rows.some(r => r.edited || r.added || r.restored) || original.length !== list.length;
        if (edited) track('photo_weights.edited');
        track('photo_weights.added');
        this.close(state, true);
        UIManager.showToast(tn('msg.photo_weights.added', n, { add: t('ui.common.add_bill') }), 4000);
        return true;
    }
};
