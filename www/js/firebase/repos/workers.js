/**
 * @fileoverview Repository of worker pay (#373 phase 1): `workers/{id}`, one document per worker
 * with its pay steps and its entries (payments and advances), each saved with its one expense (WP-12).
 * Owner only (firestore.rules "Worker pay"). Imported with the Workers page only, never at start.
 * @module firebase/repos/workers
 */

import { entryDocs } from './entry-docs.js';

const docs = () => entryDocs('workers');

/** Every worker: one read per worker (one when there are none). */
export const loadWorkers = () => docs().load();

/**
 * @param {{name: string, startMonth: string, pay: number}} w
 * @returns {Promise<string>} the new id
 */
export const addWorker = ({ name, startMonth, pay }) => docs().create({ name, startMonth, active: true, pays: [{ from: startMonth, amount: pay }] });

/**
 * Name, start month, pay steps or active flag.
 * @param {string} id
 * @param {{name?: string, startMonth?: string, pays?: Array<{from: string, amount: number}>, active?: boolean}} patch
 */
export const updateWorker = (id, patch) => docs().update(id, patch);

/** Adds one entry (arrayUnion: two phones never overwrite each other's entries). */
export const addEntry = (id, entry) => docs().addEntry(id, entry);

/** Removes one entry, exactly as loaded. */
export const removeEntry = (id, entry) => docs().removeEntry(id, entry);

/** The worker's half of a pay entry saved with its expense in one batch (entry-docs payWrite). */
export const payWrite = (id, entry) => docs().payWrite(id, entry);

/** "Add to Money figures" for an entry recorded before entries made expenses. */
export const linkedWrite = (id, payId) => docs().linkedWrite(id, payId);
