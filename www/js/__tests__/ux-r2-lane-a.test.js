/**
 * UX re-audit 21 Nov 2026, round 2 lane A: one name for the Dues page (NEW-03), "Form cleared" (NEW-09)
 * and the copy fixes (NEW-18).
 */
import fs from 'fs';
import path from 'path';
import { TAB_SHORTCUTS } from '../utils/keyboard-shortcuts.js';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

const WWW = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(WWW, p), 'utf8');

describe('NEW-03: the dues page is "Dues" in English everywhere', () => {
    test('tab bar, page title, sidebar, shortcuts and links use one word; Hindi stays बकाया', () => {
        expect(en['ui.nav.outstanding']).toBe('Dues');
        expect(en['ui.nav.outstanding_short']).toBe('Dues');
        expect(hi['ui.nav.outstanding']).toBe('बकाया');
        expect(TAB_SHORTCUTS.find(s => s.tabId === 'due')).toMatchObject({ en: 'Dues', hi: 'बकाया' });
        for (const key of ['ui.ask.open_outstanding', 'ui.insights.open_outstanding', 'ui.insights.dues_link']) expect(en[key]).toBe('Open Dues');
    });

    test('no English text or template says "Outstanding"', () => {
        expect(Object.entries(en).filter(([, v]) => /outstanding/i.test(v))).toEqual([]);
        for (const f of ['due', 'navigation', 'insights', 'settings', 'day']) {
            expect(read(`templates/${f}.html`).replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/>[^<]*Outstanding[^<]*</);
        }
    });
});

describe('NEW-09 and NEW-18: copy', () => {
    test('clearing the bill form says "Form cleared", not the word used for settling a due', () => {
        expect(en['msg.billing.bill_cleared']).toBe('Form cleared');
        expect(hi['msg.billing.bill_cleared']).not.toMatch(/बिल/);
    });

    test('sentence case, an ellipsis character and no colon before an action', () => {
        expect(en['ui.billing.name_needed_for_due']).toBe('Name (needed if anything is due)');
        expect(en['ui.money.checks_warn']).not.toMatch(/:/);
        expect(hi['ui.money.checks_warn']).not.toMatch(/:/);
        for (const cat of [en, hi]) expect(Object.entries(cat).filter(([, v]) => v.includes('...'))).toEqual([]);
    });
});
