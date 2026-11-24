// @ts-check
/**
 * @fileoverview The slip's weights list as a grid (WEIGHT-TEXT, docs/calculations.md): pure layout, no canvas.
 * @module utils/weight-grid
 */

import { formatWeight } from './money.js';

/** Breathing room between two weight columns on the slip (layout dots). */
const WEIGHT_GAP = 12;

/**
 * The slip's weights list: each at one decimal (formatWeight), right-aligned in equal columns as wide as "999.9"
 * (or the widest weight), as many per line as fit `width`.
 * @param {Array<*>} weights
 * @param {(s: string) => number} measure text width in dots
 * @param {number} width room in dots
 * @returns {{cell: number, perLine: number, rows: string[][], right: (i: number) => number}} right(i): column i's right edge
 */
export function weightGrid(weights, measure, width) {
    const texts = (weights || []).map(w => formatWeight(w));
    const cell = Math.ceil(Math.max(measure('999.9'), ...texts.map(measure)));
    const perLine = Math.max(1, Math.floor((width + WEIGHT_GAP) / (cell + WEIGHT_GAP)));
    const rows = [];
    for (let i = 0; i < texts.length; i += perLine) rows.push(texts.slice(i, i + perLine));
    return { cell, perLine, rows, right: (i) => (i + 1) * cell + i * WEIGHT_GAP };
}
