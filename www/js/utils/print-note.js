// @ts-check
/**
 * @fileoverview "Print in bill" for the bill's note: off until ticked; a new bill starts with the last
 * choice made on this phone (owner, v760). An edited, restored or drafted bill keeps its own.
 * @module utils/print-note
 */

import { safeSetItem } from './storage-full.js';

export const PRINT_NOTE_KEY = 'bahi.printNote';

/** What a new bill's "Print in bill" starts with on this phone. */
export function printNoteDefault() {
    try { return localStorage.getItem(PRINT_NOTE_KEY) === '1'; } catch { return false; }
}

/** The user ticked or unticked "Print in bill": the next new bill starts the same. */
/** @param {boolean} on */
export function rememberPrintNote(on) {
    safeSetItem(PRINT_NOTE_KEY, on ? '1' : '0');
}
