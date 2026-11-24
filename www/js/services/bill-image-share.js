/**
 * @fileoverview WhatsApp share of a bill as its receipt picture: drawn by the printer's own
 * receipt drawing (receipt-drawing.js `_renderBillCanvas` → `_drawBill`, the one layout) at
 * 2× on white, not reduced to black and white, with a short caption. Android app: the
 * customer's chat in WhatsApp (AppShell.shareToWhatsApp), else the share sheet; browser: Web
 * Share with the file, else a download plus the text. A failure sends the bill as text.
 * @module services/bill-image-share
 */

import { PrinterService, loadReceiptDrawing } from './printer.js';
import { track } from './usage.js';
import { UIManager } from '../ui/ui-manager.js';
import { t } from '../i18n/index.js';
import { PAPER_DOTS } from '../utils/printer-settings.js';
import { shellMethod } from '../utils/native-shell.js';
import { openExternal } from '../utils/open-external.js';
import { whatsAppReminderUrl } from '../utils/due-reminder.js';
import { billPhone, buildBillShareCaption, reprintType } from '../utils/bill-share.js';

/** The picture is the 58 mm layout drawn at 2× (768 px wide), plus a white margin. */
export const SHARE_SCALE = 2;
export const SHARE_DOTS = PAPER_DOTS[58] * SHARE_SCALE;
const MARGIN = 16 * SHARE_SCALE;
const CACHE_DIR = 'bill-share';

const isNative = (win) => !!win.Capacitor?.isNativePlatform?.();
const isCancel = (e) => e?.name === 'AbortError' || /cancel/i.test(String(e?.message || e || ''));

/**
 * The bill's receipt as a share picture: the printed slip's drawing and receipt options, `SHARE_DOTS` wide.
 * @param {Object} billData a print payload
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderBillImage(billData) {
    await loadReceiptDrawing();
    const slip = await PrinterService.manager.generateBillCanvas(billData, PrinterService.receiptOptions(), SHARE_DOTS);
    const canvas = document.createElement('canvas');
    canvas.width = slip.width + MARGIN * 2;
    canvas.height = slip.height + MARGIN * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(slip, MARGIN, MARGIN);
    return canvas;
}

/** @returns {Promise<Blob>} */
function pngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no image'))), 'image/png');
    });
}

/** @returns {Promise<string>} base64 of the blob */
function base64Of(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/** Android app: the picture in the app's cache (one at a time); its file:// uri. */
async function writeCache(win, blob, filename) {
    const { Filesystem } = win.Capacitor.Plugins;
    await Filesystem.rmdir({ path: CACHE_DIR, directory: 'CACHE', recursive: true }).catch(() => {});
    const { uri } = await Filesystem.writeFile({ path: `${CACHE_DIR}/${filename}`, data: await base64Of(blob), directory: 'CACHE', recursive: true });
    return uri;
}

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Sends the bill's text on WhatsApp: the customer's chat when the bill has their number.
 * @param {string} text
 * @param {string} phone
 * @returns {'text'}
 */
export function shareBillText(text, phone, win = window) {
    track('share.whatsapp');
    openExternal(whatsAppReminderUrl(text, phone), win);
    return 'text';
}

/**
 * Shares the bill's receipt picture with a caption; falls back to the text, with a toast.
 * @param {Object} billData a print payload (buildReprintPayload, or a draft with `isDraft: true`)
 * @param {{type?: string, text: string, win?: any}} opts text: the bill's WhatsApp text (the fallback)
 * @returns {Promise<'whatsapp'|'sheet'|'web'|'download'|'text'|'cancelled'>} how it went
 */
export async function shareBillImage(billData, { type, text, win = window }) {
    const kind = reprintType(billData, type);
    const phone = billPhone(billData);
    const caption = buildBillShareCaption(billData, kind);
    const filename = `${kind}_bill_${billData.billNumber || 'draft'}${billData.isCopy ? '_copy' : ''}.png`;
    try {
        const blob = await pngBlob(await renderBillImage(billData));
        if (isNative(win)) {
            const uri = await writeCache(win, blob, filename);
            const direct = shellMethod('shareToWhatsApp', win);
            if (direct) {
                const res = await direct({ uri, text: caption, phone });
                if (res?.opened) return done('whatsapp');
            }
            const Share = win.Capacitor.Plugins?.Share;
            if (!Share?.share) throw new Error('no share plugin');
            await Share.share({ files: [uri], text: caption, dialogTitle: t(`ui.bill.title_${kind}`) });
            return done('sheet');
        }
        const file = new File([blob], filename, { type: 'image/png' });
        if (win.navigator?.canShare?.({ files: [file] })) {
            await win.navigator.share({ files: [file], text: caption });
            return done('web');
        }
        download(blob, filename);
        shareBillText(text, phone, win);
        return 'download';
    } catch (error) {
        if (isCancel(error)) return 'cancelled';
        console.warn('Bill picture share failed:', error?.message || error);
        UIManager.showToast(t('msg.share.image_failed_text'), 'warning');
        return shareBillText(text, phone, win);
    }
}

/**
 * The WhatsApp buttons: the picture, or the text when held (`asText`, "Share as text").
 * @param {Object} billData
 * @param {{type?: string, text: string, asText?: boolean, win?: any}} opts
 */
export function shareBill(billData, { asText = false, ...opts }) {
    if (asText) return Promise.resolve(shareBillText(opts.text, billPhone(billData), opts.win));
    return shareBillImage(billData, opts);
}

function done(how) {
    track('share.whatsapp');
    return how;
}
