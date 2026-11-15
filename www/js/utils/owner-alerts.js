// @ts-check
/**
 * @fileoverview Owner alerts kept on this phone: people waiting to join (U-24) and dues written
 * off by someone else (U-08). Pure helpers, plus the waiting count the app last saw (one users
 * query on the owner's phone, or the Team lists); nothing is stored in Firestore.
 * @module utils/owner-alerts
 */

import { emit, REMINDERS_CHANGED } from './events.js';

/** @type {?number} */
let pendingJoins = null;

/**
 * People waiting for approval, as last read on this phone (null: not read this session).
 * @param {*} n
 */
export function setPendingJoins(n) {
    const value = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    if (value === pendingJoins) return;
    pendingJoins = value;
    emit(REMINDERS_CHANGED);
}

/** @returns {?number} */
export const getPendingJoins = () => pendingJoins;

/** Sign-out: the next person's phone session starts unknown. */
export function resetOwnerAlerts() {
    pendingJoins = null;
}

/** How far back a write-off by someone else stays in the owner's bell. */
export const WRITE_OFF_ALERT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dues written off (payments[] entries of kind writeOff) by anyone other than `uid` in the last
 * `days` days, newest first: the owner hears about a Member's write-off (U-08).
 * @param {{[kind: string]: Array<?Rec>|undefined}} billsByKind - purchase / retail / wholesale bills in memory
 * @param {string} uid - the owner looking
 * @param {number} [now]
 * @param {number} [days]
 * @returns {Array<{key: string, billId: string, billType: string, billNumber: string, party: string, amount: number, by: string, at: number}>}
 */
export function writeOffsByOthers(billsByKind, uid, now = Date.now(), days = WRITE_OFF_ALERT_DAYS) {
    const from = now - days * DAY_MS;
    /** @type {Array<{key: string, billId: string, billType: string, billNumber: string, party: string, amount: number, by: string, at: number}>} */
    const out = [];
    for (const [kind, bills] of Object.entries(billsByKind || {})) {
        for (const bill of bills || []) {
            if (!bill) continue;
            for (const p of Array.isArray(bill?.payments) ? bill.payments : []) {
                if (p?.kind !== 'writeOff' || !p.recordedById || String(p.recordedById) === String(uid)) continue;
                const at = Number(p.at);
                if (!Number.isFinite(at) || at < from || at > now + DAY_MS) continue;
                out.push({
                    key: `wo:${p.id || `${bill.id}:${at}`}`,
                    billId: String(bill.id),
                    billType: kind,
                    billNumber: String(bill.billNumber || ''),
                    party: String(bill.customerName || bill.seller || bill.buyer || ''),
                    amount: Number(p.amount) || 0,
                    by: String(p.recordedBy || ''),
                    at
                });
            }
        }
    }
    return out.sort((a, b) => b.at - a.at);
}
