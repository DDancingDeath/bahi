/**
 * UX re-validation 21 Nov 2026, lane Z: Today › Cash metric grid (F05), the desktop Day report buttons (F07),
 * the Insights items table on a phone (F25) and the shared skeleton() loading placeholder (F63).
 */
import fs from 'fs';
import path from 'path';
import { CashManagementManager as C } from '../modules/cash-management.js';
import { skeleton } from '../ui/components.js';
import { TAB_SHORTCUTS } from '../utils/keyboard-shortcuts.js';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

const WWW = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(WWW, p), 'utf8');
const TEMPLATE = read('templates/cash-management.html');
const spans = () => [...document.querySelectorAll('#statusCardsContainer > .metric-span')].map(el => el.id);

describe('F05: Today › Cash figures', () => {
    beforeEach(() => {
        document.body.innerHTML = TEMPLATE;
        C.todaySession = null;
        C.todayTransactions = {};
    });

    test('a 2×2 grid with Expected cash as the fourth figure, standing out; no hero above it', () => {
        C.updateStatusCard();
        expect(spans()).toEqual([]);
        const grid = document.getElementById('statusCardsContainer');
        const shown = () => [...grid.children].filter(el => el.style.display === 'block').map(el => el.id);
        expect(shown()).toEqual(['statusOpeningCard', 'statusCashInCard', 'statusCashOutCard', 'statusAvailableCard']);
        const expected = document.getElementById('statusAvailableCard');
        expect(expected.hasAttribute('data-emphasis')).toBe(true);
        expect(expected.querySelector('.metric-label').textContent).toBe('Expected cash');
        expect(document.querySelector('#cashStatusCard .hero, #cashStatusCard .hero-num')).toBeNull();
        expect(read('css/surfaces.css')).toMatch(/\.metrics > \.metric\[data-emphasis\] \{\s*background: var\(--accent-soft\);/);
        C.todaySession = { openingBalance: 500 };
        C.todayTransactions = { cashSales: 100 };
        C.updateStatusCard();
        expect(spans()).toEqual([]);
        expect(document.getElementById('statusAvailable').textContent).toBe('₹600');
        expect(document.getElementById('statusCountLine').hidden).toBe(true);
    });

    test('cash added makes five figures: Expected cash takes the row, no empty cell', () => {
        C.todaySession = { openingBalance: 500 };
        C.todayTransactions = { cashDeposits: 200 };
        C.updateStatusCard();
        expect(spans()).toEqual(['statusAvailableCard']);
    });

    test('counted (closed): one line under the grid, short in red, extra in amber, within ₹1 matches in green; not counted: no line', () => {
        const line = () => document.getElementById('statusCountLine');
        const close = (closingBalance, difference, counted = true) => {
            C.todaySession = { openingBalance: 500, signedOut: true, counted, transactions: {}, expectedBalance: 9312, closingBalance, difference };
            C.updateStatusCard();
            return [line().hidden, line().textContent.replace(/\s+/g, ' ').trim(), document.getElementById('statusDiff').className];
        };
        expect(close(9250, -62)).toEqual([false, 'Counted ₹9,250 · ₹62.00 short', 'tone-neg']);
        expect(close(9352, 40)).toEqual([false, 'Counted ₹9,352 · ₹40.00 extra', 'tone-warn']);
        expect(close(9312.5, 0.5)).toEqual([false, 'Counted ₹9,312.50 · matches', 'tone-pos']);
        expect(close(0, 0, false)[0]).toBe(true);
        expect(spans()).toEqual([]);
    });
    test('one visible caption: "Today\'s cash" is for screen readers', () => {
        expect(document.getElementById('cashStatusTitle').classList.contains('sr-only')).toBe(true);
        expect(read('css/surfaces.css')).toMatch(/\.metrics > \.metric-span \{\s*grid-column: 1 \/ -1;\s*\}/);
    });
});

test('F07: on desktop the Day report buttons take the row, so "I corrected" is never cut off', () => {
    const css = read('css/desktop.css');
    const rule = css.match(/\.day-report \.anom-actions \{([^}]*)\}/);
    expect(rule[1]).toMatch(/flex: 1 1 100%/);
    expect(rule[1]).toMatch(/min-width: 0/);
    // One button and ⋯ on one line (NEW-19); "I corrected it" is in the ⋯ menu, which floats
    expect(read('css/anomalies.css')).toMatch(/\.anom-actions \{[^}]*flex-wrap: nowrap/);
    expect(read('css/surfaces.css')).toMatch(/\.menu-list \{[^}]*position: absolute/);
});

test('F25: on a phone the items table leaves out "vs last year" so Profit per ₹100 fits', () => {
    const phone = read('css/insights.css').match(/@media \(max-width: 599\.98px\) \{([\s\S]*?)\n\}/);
    expect(phone[1]).toMatch(/\.ins-items-table \.ins-ly \{ display: none; \}/);
    expect(read('js/modules/insights.js').match(/class="num ins-ly"/g)).toHaveLength(2);
});

describe('F63: skeleton()', () => {
    test('bars in a panel with an escaped label for screen readers, not an "empty" line', () => {
        document.body.innerHTML = skeleton({ label: '<Loading>' });
        const box = document.body.firstElementChild;
        expect(box.matches('.panel.skel-list[role="status"][aria-busy="true"]')).toBe(true);
        expect(box.querySelectorAll('.skel')).toHaveLength(3);
        expect(box.querySelector('.sr-only').textContent).toBe('<Loading>');
        expect(document.querySelector('.empty, script')).toBeNull();
    });

    test('rows are clamped to 1–8; panel: false inside a host that is already a panel', () => {
        document.body.innerHTML = skeleton({ label: 'x', rows: 99, panel: false });
        expect(document.querySelectorAll('.skel')).toHaveLength(8);
        expect(document.body.firstElementChild.classList.contains('panel')).toBe(false);
        document.body.innerHTML = skeleton({ label: 'x', rows: 0 });
        expect(document.querySelectorAll('.skel')).toHaveLength(1);
    });
});

test('F32: the keyboard shortcut list names the page as the menu does', () => {
    const rates = TAB_SHORTCUTS.find(x => x.tabId === 'rates');
    expect([rates.en, rates.hi]).toEqual([en['ui.nav.rates'], hi['ui.nav.rates']]);
});
