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

    test('three figures (no cash open, or open without cash added): the last spans the row, no empty cell', () => {
        C.updateStatusCard();
        expect(spans()).toEqual(['statusCashOutCard']);
        C.todaySession = { openingBalance: 500 };
        C.todayTransactions = { cashSales: 100 };
        C.updateStatusCard();
        expect(spans()).toEqual(['statusCashOutCard']);
    });

    test('an even number of figures (cash added, or the closed day) spans none', () => {
        C.todaySession = { openingBalance: 500 };
        C.todayTransactions = { cashDeposits: 200 };
        C.updateStatusCard();
        expect(spans()).toEqual([]);
        C.todaySession = { openingBalance: 500, signedOut: true, transactions: {}, expectedBalance: 500, closingBalance: 500 };
        C.updateStatusCard();
        expect(spans()).toEqual([]);
    });

    test('one visible caption: "Today\'s cash" is for screen readers, "Available cash" labels the figure', () => {
        expect(document.getElementById('cashStatusTitle').classList.contains('sr-only')).toBe(true);
        expect(read('css/day.css')).toMatch(/\.cash-metrics > \.metric-span \{ grid-column: 1 \/ -1; \}/);
    });
});

test('F07: on desktop the Day report buttons take the row, so "I corrected" is never cut off', () => {
    const css = read('css/desktop.css');
    const rule = css.match(/\.day-report \.anom-actions \{([^}]*)\}/);
    expect(rule[1]).toMatch(/flex: 1 1 100%/);
    expect(rule[1]).toMatch(/min-width: 0/);
    // One button and ⋯ on one line (NEW-19); "I corrected it" is in the ⋯ menu, which floats
    expect(read('css/anomalies.css')).toMatch(/\.anom-actions \{[^}]*flex-wrap: nowrap/);
    expect(read('css/anomalies.css')).toMatch(/\.anom-overflow-menu \{[^}]*position: absolute/);
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
