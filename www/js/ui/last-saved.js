/**
 * @fileoverview "Last saved" strip above a bill form (U-05): after a save it shows the bill number,
 * party, total and due (or "Saved on phone, not sent yet" offline) with Print, WhatsApp and Open, and
 * stays until the next save of that form or ×. The same strip on Purchase, Retail sale and Wholesale.
 * @module ui/last-saved
 */

import { FirebaseService } from '../firebase/firestore-service.js';
import { PrinterService } from '../services/printer.js';
import { buildBillShareText, buildReprintPayload } from '../utils/bill-share.js';
import { billTotal, formatRupees, outstandingDue } from '../utils/money.js';
import { printStatusOf } from '../utils/print-status.js';
import { whatsAppShareUrl } from '../utils/release-info.js';
import { openExternal } from '../utils/open-external.js';
import { t } from '../i18n/index.js';
import { icon } from './icons.js';

/** Strip element per bill form. */
const BOX = Object.freeze({ purchase: 'purchaseLastSaved', retail: 'saleLastSaved', wholesale: 'wholesaleLastSaved' });

/** @type {Object<string, ?Object>} the last bill saved on each form, this session */
const last = {};

/**
 * @param {string} cls
 * @param {string} label
 * @param {string} iconHtml - the button's icon (sprite markup)
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function button(cls, label, iconHtml, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-sm ${cls}`;
    b.insertAdjacentHTML('afterbegin', iconHtml);
    const span = document.createElement('span');
    span.textContent = label;
    b.appendChild(span);
    b.addEventListener('click', onClick);
    return b;
}

/**
 * Draws the strip of one form ('' when nothing was saved there yet).
 * @param {'purchase'|'retail'|'wholesale'} kind
 */
export function renderLastSaved(kind) {
    const box = document.getElementById(BOX[kind]);
    if (!box) return;
    const bill = last[kind];
    box.hidden = !bill;
    if (!bill) {
        box.replaceChildren();
        return;
    }
    const onPhone = FirebaseService.savedOnPhoneOnly(bill);
    const head = document.createElement('div');
    head.className = 'last-saved-head';
    head.insertAdjacentHTML('afterbegin', onPhone ? icon('refresh', 'i-sm') : icon('check', 'i-sm'));
    const title = document.createElement('span');
    title.textContent = onPhone ? t('ui.last_saved.on_phone', { no: bill.billNumber || '' }) : t('ui.last_saved.saved', { no: bill.billNumber || '' });
    head.appendChild(title);
    const due = outstandingDue(bill);
    const facts = document.createElement('div');
    facts.className = 'last-saved-facts';
    facts.textContent = [
        bill.customerName || '',
        formatRupees(billTotal(bill)),
        due > 0 ? t('ui.last_saved.due', { amount: formatRupees(due) }) : t('ui.last_saved.paid')
    ].filter(Boolean).join(' · ');
    const actions = document.createElement('div');
    actions.className = 'last-saved-actions';
    actions.append(
        button('btn-tonal', t('ui.common.print'), icon('printer', 'i-sm'), () => printLastSaved(kind)),
        button('btn-tonal', t('ui.last_saved.whatsapp'), icon('wa', 'i-sm'), () => shareLastSaved(kind)),
        button('btn-ghost', t('ui.last_saved.open'), icon('chevR', 'i-sm'), () => window.app?.history?.viewBill?.(`id:${bill.id}`, kind)),
        button('btn-ghost btn-icon last-saved-close', '', icon('x', 'i-sm'), () => hideLastSaved(kind))
    );
    const close = actions.querySelector('.last-saved-close');
    close?.setAttribute('aria-label', t('ui.last_saved.hide'));
    box.replaceChildren(head, facts, actions);
}

/**
 * A bill was saved on this form: the strip shows it.
 * @param {'purchase'|'retail'|'wholesale'} kind
 * @param {Object} bill - the bill as saved
 */
export function showLastSaved(kind, bill) {
    if (!bill || !BOX[kind]) return;
    last[kind] = bill;
    renderLastSaved(kind);
}

/** × on the strip. */
export function hideLastSaved(kind) {
    last[kind] = null;
    renderLastSaved(kind);
}

/** Print from the strip: the first slip unmarked, a slip already printed again as a copy. */
export async function printLastSaved(kind) {
    const bill = last[kind];
    if (!bill) return;
    const payload = buildReprintPayload(bill, kind);
    if (printStatusOf(bill)?.s !== 'printed') payload.isCopy = false;
    try {
        await PrinterService.printBill(payload);
    } catch (error) {
        console.error('Print from Last saved failed:', error);
    }
}

/** WhatsApp from the strip: the saved bill's text (not a draft). */
export function shareLastSaved(kind) {
    const bill = last[kind];
    if (!bill) return;
    openExternal(whatsAppShareUrl(buildBillShareText(bill, kind, { copy: false })));
}
