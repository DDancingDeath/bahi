/**
 * @fileoverview Repository of recurring bills (#437 phase 1): `recurringBills/{id}`, one document per
 * bill item (electricity, water …) with its cadence and its entries (bill amounts and payments).
 * Owner, managers and members (Roles & access; firestore.rules "Recurring bills"). Imported with the page only.
 * @module firebase/repos/recurring-bills
 */

import { entryDocs } from './entry-docs.js';
import { getDb, col, serverCreatedAt } from '../db.js';

const docs = () => entryDocs('recurringBills');

/** Every bill item: one read per item (one when there are none). */
export const loadBillItems = () => docs().load();

/**
 * @param {{name: string, cadence: number, dueDay: number, startMonth: string, expected: number, note: string}} item
 * @returns {Promise<string>} the new id
 */
export const addBillItem = (item) => docs().create({ ...item, active: true, endMonth: '' });

/** Name, due day, expected amount, note, cadence / first month (no entries yet) or stopped. */
export const updateBillItem = (id, patch) => docs().update(id, patch);

/** Adds one bill amount or payment (arrayUnion). */
export const addEntry = (id, entry) => docs().addEntry(id, entry);

/** Removes one payment, exactly as loaded. */
export const removeEntry = (id, entry) => docs().removeEntry(id, entry);

const billRef = (id) => getDb().collection(col('recurringBills')).doc(String(id));

/**
 * The bill item's half of a payment saved with its expense in one batch (FirebaseService
 * startSaveExpense / linkExpense withBatch): the payment, linked to the expense.
 * @param {string} id bill item
 * @param {Object} entry the payment (kind 'pay')
 * @returns {(batch: *, expenseId: string) => void}
 */
export const payWrite = (id, entry) => (batch, expenseId) => batch.update(billRef(id), {
    entries: firebase.firestore.FieldValue.arrayUnion({ ...entry, expenseId }), updatedAt: serverCreatedAt()
});

/** "Add to Money" (owner) for a payment recorded before payments made expenses: links its new expense. */
export const linkedWrite = (id, payId) => (batch, expenseId) => batch.update(billRef(id), {
    [`linked.${payId}`]: expenseId, updatedAt: serverCreatedAt()
});