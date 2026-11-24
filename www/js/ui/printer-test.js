/**
 * @fileoverview Settings › Printing › Check the printer (also in Billing's printer sheet, which
 * shows the same panel): a connection check, a test page and a photo print. The photo is fitted to
 * the paper (384 dots for 58 mm, 576 for 80 mm), at most PHOTO_MAX_ROWS tall, dithered to black
 * and white with brightness / contrast, and sent as GS v 0 bands with a pause after each, with a
 * progress line and Cancel. Bytes come from utils/escpos-image.js. Imported on first use.
 * @module ui/printer-test
 */

import { PrinterService, packMonochromeRaster } from '../services/printer.js';
import { PrinterTelemetry } from '../services/printer-telemetry.js';
import { UIManager, buildSheet, openSheet, closeSheet } from './ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { AppState } from '../utils/state.js';
import { t, loadAllCatalogues } from '../i18n/index.js';
import { APP_VERSION } from '../version.js';
import { APP_IDENTITY } from '../config/app-identity.js';
import { encodeQr } from '../utils/qr-code.js';
import { PAPER_DOTS, PAPER_WIDTHS, currentPrinter, receiptLang } from '../utils/printer-settings.js';
import { safeSetItem } from '../utils/storage-full.js';
import {
    CANCEL_TAIL, CHUNK_DELAY_MS, DITHERS, PHOTO_MAX_ROWS, fitToPaper, percentSent, photoToEscPos, rasterJobChunks
} from '../utils/escpos-image.js';

const LAST_KEY = 'printerLastTest';
/** Printed in the printer's own font before the picture: shows that text mode works too. */
const FONT_LINE = 'Printer font: OK (ABC abc 0123456789)';
const LAYOUT_DOTS = PAPER_DOTS[58];

const el = (tag, cls = '', text = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
};

const clock = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The last test (or any print this session, if newer): {at, outcome, kind}. */
function lastResult() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { saved = null; }
    const { lastJob, lastError } = PrinterService.manager.link.status;
    if (lastJob && !(saved?.at >= lastJob.at)) {
        return { at: lastJob.at, outcome: lastJob.outcome, kind: lastJob.outcome === 'printed' ? null : lastError?.kind || null };
    }
    return saved?.at ? saved : null;
}

function saveResult(outcome, error) {
    safeSetItem(LAST_KEY, JSON.stringify({ at: Date.now(), outcome, kind: error?.kind || null }));
}

const RESULT_KEYS = {
    printed: 'ui.printer_test.result_printed',
    failed: 'ui.printer_test.result_failed',
    uncertain: 'ui.printer_test.result_uncertain',
    cancelled: 'ui.printer_test.result_cancelled'
};

/**
 * The check as rows: [{text, ok}] (ok false = a problem to fix, null = neutral).
 * @param {{available: boolean, printer: string, widthMm: number, bluetooth: string, permission: string,
 *   connected: boolean, last: ?{at: number, outcome: string, kind: ?string}}} s
 * @returns {{text: string, ok: ?boolean}[]}
 */
export function checkRows(s) {
    if (!s.available) return [{ text: t('ui.settings.printer_android_only'), ok: false }];
    const rows = [
        s.printer
            ? { text: t('ui.printer_test.check_printer', { name: s.printer, width: t('ui.settings.paper_mm', { mm: s.widthMm }) }), ok: true }
            : { text: t('ui.printer_test.check_no_printer'), ok: false },
        { text: t(s.bluetooth === 'off' ? 'ui.printer_test.check_bt_off' : 'ui.printer_test.check_bt_on'), ok: s.bluetooth !== 'off' },
        {
            text: t(`ui.printer_test.check_perm_${s.permission}`),
            ok: s.permission === 'granted' || s.permission === 'not_needed' ? true : s.permission === 'denied' ? false : null
        },
        { text: t(s.connected ? 'ui.printer_test.check_connected' : 'ui.printer_test.check_not_connected'), ok: s.connected ? true : null }
    ];
    const last = s.last;
    if (!last) {
        rows.push({ text: t('ui.printer_test.check_last_none'), ok: null });
    } else {
        const result = t(RESULT_KEYS[last.outcome] || RESULT_KEYS.failed);
        const why = last.outcome === 'failed' && last.kind ? ` (${PrinterService.errorText({ kind: last.kind })})` : '';
        rows.push({ text: t('ui.printer_test.check_last', { time: clock(last.at), result: result + why }), ok: last.outcome === 'printed' ? true : last.outcome === 'cancelled' ? null : false });
    }
    return rows;
}

/**
 * Live state: Bluetooth, Nearby devices (CONNECT + SCAN), the link, the last print.
 * ask false: only what the printer status already knows (no Bluetooth or permission calls).
 */
async function connectionState({ ask = true } = {}) {
    const available = PrinterService.isAvailable();
    const saved = PrinterService.settings();
    const link = PrinterService.manager.link;
    const state = {
        available,
        printer: saved.deviceId ? (PrinterService.manager.printerName || saved.deviceName || saved.deviceId) : '',
        widthMm: currentPrinter(saved)?.widthMm || 58,
        bluetooth: 'unknown',
        permission: 'not_needed',
        connected: false,
        last: lastResult()
    };
    if (!available) return state;
    if (ask) {
        await link.bluetoothOn();
        await PrinterService.bluetoothPermission();
    }
    state.bluetooth = link.status.bluetoothOff ? 'off' : 'on';
    const d = PrinterService.permissionDetail;
    if (d) {
        state.permission = d.connect === 'granted' && d.scan === 'granted' ? 'granted'
            : d.connect === 'denied' || d.scan === 'denied' ? 'denied' : 'unknown';
    }
    state.connected = PrinterService.isConnected() && (!ask || (await PrinterService.checkConnection()));
    return state;
}

function renderRows(rows) {
    const list = document.getElementById('printerCheckList');
    if (!list) return;
    list.textContent = '';
    rows.forEach(({ text, ok }) => {
        const li = el('li', ok === true ? 'tone-pos' : ok === false ? 'tone-warn' : 'tone-muted');
        li.append(el('span', 'printer-check-mark', ok === true ? '●' : ok === false ? '!' : '○'), document.createTextNode(` ${text}`));
        list.appendChild(li);
    });
}

/** The reason in words, as a toast and in Crashlytics (a non-fatal with the step). */
function failed(step, error, where = null) {
    console.error(`[PRINTER TEST] ${step}:`, error);
    PrinterTelemetry.error(step, error);
    const message = t('msg.printer_test.failed', { message: PrinterService.errorText(error) || t('msg.printer_test.unknown') });
    if (where) where.textContent = message;
    UIManager.showToast(message, 'error', 6000);
    return message;
}

/**
 * Checks each step, then sends the chunks (one job; the printer link connects with retries).
 * @param {'test_page'|'test_photo'} step
 * @param {Uint8Array[]} chunks
 * @param {{onProgress?: (sent: number, total: number) => void, cancelled?: () => boolean, status?: HTMLElement}} [opts]
 * @returns {Promise<'printed'|'failed'|'uncertain'|'cancelled'>}
 */
async function send(step, chunks, { onProgress, cancelled, status = null } = {}) {
    const fail = (kind, message) => {
        const error = Object.assign(new Error(message), { kind });
        saveResult('failed', error);
        failed(step, error, status);
        return 'failed';
    };
    try {
        if (!PrinterService.isAvailable()) return fail('unavailable', 'Bluetooth Serial plugin not available');
        if (!PrinterService.settings().deviceId && !PrinterService.isConnected()) return fail('no_printer', 'No printer selected');
        if (await PrinterService.bluetoothPermission() === 'denied' && !(await PrinterService.requestBluetoothPermission())) {
            return fail('permission', 'Bluetooth permission needed');
        }
        try {
            await PrinterService.manager.link.enableBluetooth();
        } catch {
            return fail('bluetooth_off', 'Bluetooth is off');
        }
        PrinterTelemetry.step(step, { name: PrinterService.target().deviceName || '' });
        const res = await PrinterService.manager.link.sendChunks(chunks, PrinterService.target(), {
            mode: 'full', delayMs: CHUNK_DELAY_MS, onProgress, cancelled, cancelTail: Uint8Array.from(CANCEL_TAIL)
        });
        saveResult(res.outcome);
        return res.outcome;
    } catch (error) {
        const outcome = error?.outcome === 'uncertain' ? 'uncertain' : 'failed';
        saveResult(outcome, error);
        failed(step, error, status);
        return outcome;
    } finally {
        PrinterService.updateStatus();
        PrinterTest.check({ ask: false }).catch(() => {});
    }
}

/** The test page as a canvas: shop, date and time, app version, printer, English and Hindi, ruler, QR, Test OK. */
async function drawTestPage(dots) {
    await loadAllCatalogues();
    const lang = receiptLang(PrinterService.receipt());
    const s = dots / LAYOUT_DOTS;
    const canvas = document.createElement('canvas');
    canvas.width = dots;
    canvas.height = Math.round(900 * s);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    let y = Math.round(8 * s);
    const line = (text, size, bold = false) => {
        ctx.font = `${bold ? 'bold ' : ''}${Math.round(size * s)}px Arial`;
        ctx.fillText(String(text), dots / 2, y, dots - 8);
        y += Math.round((size + 8) * s);
    };
    const rule = () => {
        ctx.fillRect(0, y, dots, Math.max(2, Math.round(2 * s)));
        y += Math.round(12 * s);
    };
    const nativeVersion = await Promise.resolve(window.Capacitor?.Plugins?.App?.getInfo?.()).then(i => i?.version, () => null);
    const printer = PrinterService.target().deviceName || PrinterService.manager.printerName || '-';
    const mm = currentPrinter(PrinterService.settings())?.widthMm || 58;
    const now = new Date();

    line(String(AppState.settings?.shopName || '').trim() || APP_IDENTITY.appName, 26, true);
    line(t('ui.printer_test.page_heading', undefined, lang), 22, true);
    line(now.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN'), 18);
    line(t('ui.printer_test.page_version', { version: nativeVersion || APP_VERSION, build: window.__AADHAT_BUILD__ || '' }, lang), 16);
    line(t('ui.printer_test.check_printer', { name: printer, width: t('ui.settings.paper_mm', { mm }, lang) }, lang), 16);
    rule();
    line(t('ui.printer_test.page_sample', undefined, 'en'), 18);
    line(t('ui.printer_test.page_sample', undefined, 'hi'), 18);
    rule();

    // Ruler: a tick each mm (8 dots), longer each 5 mm, numbered each 10 mm
    const dotsPerMm = 8;
    ctx.font = `${Math.round(12 * s)}px Arial`;
    for (let x = 0, mmAt = 0; x < dots; x += dotsPerMm, mmAt++) {
        const len = mmAt % 10 === 0 ? 22 : mmAt % 5 === 0 ? 14 : 7;
        ctx.fillRect(Math.min(x, dots - 2), y, 2, Math.round(len * s));
        if (mmAt % 10 === 0 && mmAt > 0) ctx.fillText(String(mmAt), Math.min(x, dots - 12), y + Math.round(24 * s));
    }
    ctx.fillRect(0, y, dots, 2);
    ctx.fillRect(dots - 2, y, 2, Math.round(22 * s));
    y += Math.round(48 * s);

    const code = encodeQr(`${APP_IDENTITY.appName} printer test ${now.toISOString()}`);
    if (code) {
        const quiet = 4;
        const px = Math.max(2, Math.min(5, Math.floor(dots * 0.5 / (code.size + quiet * 2))));
        const side = (code.size + quiet * 2) * px;
        const left = Math.round((dots - side) / 2);
        for (let r = 0; r < code.size; r++) {
            for (let c = 0; c < code.size; c++) {
                if (code.modules[r][c]) ctx.fillRect(left + (c + quiet) * px, y + (r + quiet) * px, px, px);
            }
        }
        y += side + Math.round(8 * s);
    }
    line(t('ui.printer_test.page_ok', undefined, lang), 30, true);

    const height = Math.min(canvas.height, y + Math.round(8 * s));
    const { data } = ctx.getImageData(0, 0, dots, height);
    return { canvas, height, raster: packMonochromeRaster(data, dots, height), bytesPerLine: (dots + 7) >> 3 };
}

/** Resolves with the chosen picture, or null. The Android app asks: camera or gallery. */
async function pickPhoto() {
    let capture = false;
    if (window.Capacitor?.isNativePlatform?.()) {
        const choice = await UIManager.showCustomModal(`<p>${Helpers.escapeHtml(t('ui.printer_test.photo_source'))}</p>`, [
            { text: t('ui.photo_weights.take_photo'), value: 'camera', class: 'btn btn-primary' },
            { text: t('ui.photo_weights.choose_photo'), value: 'gallery', class: 'btn' },
            { text: t('ui.modals.cancel'), value: null, class: 'btn btn-ghost' }
        ]);
        if (!choice) return null;
        capture = choice === 'camera';
    }
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.hidden = true;
        if (capture) input.setAttribute('capture', 'environment');
        const done = (file) => { input.remove(); resolve(file || null); };
        input.addEventListener('change', () => done(input.files?.[0]));
        input.addEventListener('cancel', () => done(null));
        document.body.appendChild(input);
        input.click();
    });
}

/** The photo sheet: preview as it will print, paper width, brightness, contrast, dithering, Print / Cancel. */
function openPhotoSheet(bitmap) {
    const { overlay, box, body, footer } = buildSheet({ labelId: 'printerPhotoTitle', title: t('ui.printer_test.photo_title'), className: 'printer-photo' });
    box.classList.add('dialog-wide');
    const preview = el('canvas', 'printer-photo-preview');
    preview.setAttribute('role', 'img');
    preview.setAttribute('aria-label', t('ui.printer_test.photo_preview'));
    const note = el('p', 'setting-description');

    const field = (labelKey, control) => {
        const wrap = el('div', 'field');
        const label = el('label', '', t(labelKey));
        control.id = `printerPhoto_${labelKey.split('.').pop()}`;
        label.htmlFor = control.id;
        wrap.append(label, control);
        return wrap;
    };
    const select = (options, value) => {
        const s = el('select', 'input');
        options.forEach(([v, text]) => { const o = el('option', '', text); o.value = String(v); if (String(v) === String(value)) o.selected = true; s.appendChild(o); });
        return s;
    };
    const range = () => {
        const r = el('input', 'printer-photo-range');
        Object.assign(r, { type: 'range', min: '-100', max: '100', step: '5', value: '0' });
        return r;
    };
    const widthMm = currentPrinter(PrinterService.settings())?.widthMm || 58;
    const paper = select(PAPER_WIDTHS.map(mm => [mm, t('ui.settings.paper_mm', { mm })]), widthMm);
    const brightness = range();
    const contrast = range();
    const method = select(DITHERS.map(m => [m, t(`ui.printer_test.dither_${m}`)]), 'atkinson');
    const progress = el('p', 'setting-description printer-photo-progress');
    progress.setAttribute('aria-live', 'polite');
    body.append(preview, note,
        field('ui.printer_test.paper_width', paper),
        field('ui.printer_test.brightness', brightness),
        field('ui.printer_test.contrast', contrast),
        field('ui.printer_test.dither', method),
        progress);

    const closeBtn = el('button', 'btn btn-ghost', t('ui.common.close'));
    closeBtn.type = 'button';
    closeBtn.setAttribute('data-dismiss', '');
    const cancelBtn = el('button', 'btn btn-danger', t('ui.printer_test.cancel_print'));
    cancelBtn.type = 'button';
    cancelBtn.hidden = true;
    const printBtn = el('button', 'btn btn-primary', t('ui.print.print'));
    printBtn.type = 'button';
    footer.append(closeBtn, cancelBtn, printBtn);

    let chunks = [];
    let timer = null;
    let printing = false;
    let stop = false;

    const render = () => {
        timer = null;
        try {
            const dots = PAPER_DOTS[Number(paper.value)] || LAYOUT_DOTS;
            const fit = fitToPaper(bitmap.width, bitmap.height, dots);
            const work = document.createElement('canvas');
            work.width = fit.width;
            work.height = fit.height;
            const ctx = work.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, fit.width, fit.height);
            ctx.drawImage(bitmap, fit.left, 0, fit.drawWidth, fit.height);
            const { data } = ctx.getImageData(0, 0, fit.width, fit.height);
            const out = photoToEscPos(data, fit.width, fit.height, {
                brightness: Number(brightness.value), contrast: Number(contrast.value), method: method.value
            });
            chunks = out.chunks;
            preview.width = fit.width;
            preview.height = fit.height;
            const pctx = preview.getContext('2d');
            const img = pctx.createImageData(fit.width, fit.height);
            for (let i = 0, p = 0; i < out.bits.length; i++, p += 4) {
                const v = out.bits[i] ? 0 : 255;
                img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v; img.data[p + 3] = 255;
            }
            pctx.putImageData(img, 0, 0);
            note.textContent = t(fit.capped ? 'ui.printer_test.photo_size_capped' : 'ui.printer_test.photo_size', {
                width: fit.width, height: fit.height, max: PHOTO_MAX_ROWS, cm: (fit.height / 80).toFixed(1)
            });
        } catch (error) {
            chunks = [];
            failed('test_photo_render', error, note);
        }
    };
    const later = () => { if (!timer) timer = setTimeout(render, 120); };
    [brightness, contrast].forEach(r => r.addEventListener('input', later));
    [paper, method].forEach(s => s.addEventListener('change', render));

    const close = () => {
        stop = true;
        if (timer) clearTimeout(timer);
        if (!overlay.parentNode) return;
        closeSheet(overlay);
        overlay.remove();
        bitmap.close?.();
    };
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', () => {
        stop = true;
        cancelBtn.disabled = true;
        progress.textContent = t('ui.printer_test.cancelling');
    });
    printBtn.addEventListener('click', async () => {
        if (printing || !chunks.length) return;
        printing = true;
        stop = false;
        printBtn.disabled = true;
        cancelBtn.hidden = false;
        cancelBtn.disabled = false;
        progress.textContent = t('ui.printer_test.progress', { percent: 0 });
        const outcome = await send('test_photo', chunks, {
            status: progress,
            cancelled: () => stop,
            onProgress: (sent, count) => { progress.textContent = t('ui.printer_test.progress', { percent: percentSent(sent, count) }); }
        });
        if (outcome === 'printed') progress.textContent = t('ui.printer_test.photo_printed');
        else if (outcome === 'cancelled') progress.textContent = t('ui.printer_test.photo_stopped');
        else if (outcome === 'uncertain') progress.textContent = t('msg.printer.may_have_printed');
        printing = false;
        printBtn.disabled = false;
        cancelBtn.hidden = true;
    });

    document.body.appendChild(overlay);
    openSheet(overlay, { focus: printBtn });
    render();
    return { overlay, render };
}

export const PrinterTest = {
    busy: false,

    /** Runs the connection check and shows it in the panel. @param {{ask?: boolean}} [opts] */
    async check({ ask = true } = {}) {
        try {
            const state = await connectionState({ ask });
            renderRows(checkRows(state));
            return state;
        } catch (error) {
            failed('test_check', error);
            return null;
        }
    },

    /** Prints the test page. */
    async page() {
        if (this.busy) return false;
        this.busy = true;
        const btn = document.getElementById('printerTestPageBtn');
        if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
        try {
            let chunks;
            try {
                const page = await drawTestPage(PrinterService.paperDots());
                chunks = rasterJobChunks(page, { textLines: [FONT_LINE] });
            } catch (error) {
                failed('test_page_draw', error);
                return false;
            }
            const outcome = await send('test_page', chunks);
            if (outcome === 'printed') UIManager.showToast(t('msg.printer_test.page_printed'));
            else if (outcome === 'uncertain') UIManager.showToast(t('msg.printer.may_have_printed'), 'warning', 6000);
            return outcome === 'printed';
        } finally {
            this.busy = false;
            if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
        }
    },

    /** Takes or picks a photo and opens the photo sheet. */
    async photo() {
        let file;
        try {
            file = await pickPhoto();
        } catch (error) {
            failed('test_photo_pick', error);
            return null;
        }
        if (!file) return null;
        let bitmap;
        try {
            bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (error) {
            PrinterTelemetry.error('test_photo_load', error);
            UIManager.showToast(t('msg.printer_test.photo_unreadable'), 'error', 6000);
            return null;
        }
        return openPhotoSheet(bitmap);
    }
};
