/**
 * @fileoverview The sync pill's sheet (U-04): what this phone has not sent to the server yet,
 * and when it last did. Built from SyncStatus and the bills already in memory; no reads.
 * @module ui/sync-sheet
 */

import { SyncStatus, asOfText } from './sync-status.js';
import { UIManager } from './ui-manager.js';
import { AppState } from '../utils/state.js';
import { Helpers } from '../utils/helpers.js';
import { billTotal, moneyText } from '../utils/money.js';
import { t, tn } from '../i18n/index.js';

const KINDS = Object.freeze({
    purchases: { key: 'ui.sync.item_purchase', list: 'purchaseHistory' },
    retailSales: { key: 'ui.sync.item_retail', list: 'retailSalesHistory' },
    sales: { key: 'ui.sync.item_wholesale', list: 'salesHistory' },
    expenses: { key: 'ui.sync.item_expense', list: 'expensesHistory' },
    cashManagement: { key: 'ui.sync.item_cash', list: null }
});

/**
 * One line per waiting change: its kind and, for a bill or expense this phone holds, its number,
 * party and amount.
 * @param {Array<{collection: string, id: string}>} items - SyncStatus.pendingItems()
 * @param {Object} state - AppState
 * @returns {Array<{title: string, detail: string}>}
 */
export function syncSheetRows(items, state = AppState) {
    return items.map(({ collection, id }) => {
        const kind = KINDS[collection];
        const title = t(kind ? kind.key : 'ui.sync.item_other');
        const doc = kind?.list ? (state?.[kind.list] || []).find(d => String(d?.id) === String(id)) : null;
        if (!doc) return { title, detail: '' };
        const amount = collection === 'expenses' ? Number(doc.amount) : billTotal(doc);
        const parts = [
            doc.billNumber ? `#${doc.billNumber}` : '',
            doc.customerName || doc.seller || doc.buyer || doc.type || '',
            Number.isFinite(amount) ? moneyText(amount) : ''
        ];
        return { title, detail: parts.filter(Boolean).join(' · ') };
    });
}

/** Opens the sheet (the pill's tap). */
export function openSyncSheet() {
    const esc = Helpers.escapeHtml;
    const items = SyncStatus.pendingItems();
    const rows = syncSheetRows(items);
    const lastSent = SyncStatus.lastSyncAt();
    const lastData = SyncStatus.serverDataAt();
    const meta = [
        t(SyncStatus.isOnline() ? 'ui.sync.sheet_online' : 'ui.sync.sheet_offline'),
        lastSent ? t('ui.sync.sheet_last_sync', { time: asOfText(lastSent) }) : '',
        lastData ? t('ui.sync.sheet_last_data', { time: asOfText(lastData) }) : ''
    ].filter(Boolean);
    const list = rows.length
        ? `<ul class="sync-sheet-list">${rows.map(r => `<li><strong>${esc(r.title)}</strong>${r.detail ? `<div class="sync-sheet-meta">${esc(r.detail)}</div>` : ''}</li>`).join('')}</ul>`
            + `<p>${esc(t('ui.sync.sheet_note'))}</p>`
        : `<p>${esc(t('ui.sync.sheet_none'))}</p>`;
    const html = `<h3 class="dialog-title">${esc(rows.length ? `${t('ui.sync.sheet_title')} · ${tn('ui.sync.not_sent', rows.length)}` : t('ui.sync.sheet_title'))}</h3>`
        + list
        + meta.map(m => `<p class="sync-sheet-meta">${esc(m)}</p>`).join('');
    return UIManager.showCustomModal(html, [{ text: t('ui.common.close'), value: null, class: 'btn btn-primary' }]);
}
