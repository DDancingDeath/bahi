/**
 * @fileoverview Purchase / Retail sale line entry (option C): every field has a real <label> that floats on its
 * border and stays there with a value (.field-float, never a placeholder as label); Customer | 🎙 (the one
 * whole-bill mic), then Item | Rate and Weight | 📷 | Add; the 🎙 shows only with Voice billing on, the 📷 only
 * with Photo of weights on; the ⋯ menu sits beside Purchase / Retail sale and holds Drafts with a count badge;
 * Save & print is the action row's one primary. Runs on the real billing.html.
 */
import fs from 'fs';
import path from 'path';
import { BillingManager } from '../modules/billing.js';
import * as BillDrafts from '../firebase/repos/bill-drafts.js';
import { VoiceMic, VOICE_KEY } from '../ui/voice-mic.js';
import { PhotoWeights } from '../ui/photo-weights.js';
import '../ui/number-input.js';
import { AppState } from '../utils/state.js';
import { applyTranslations, setLang } from '../i18n/index.js';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

jest.mock('../firebase/repos/bill-drafts.js', () => ({
    countDrafts: jest.fn().mockResolvedValue(0)
}));

const WWW = path.join(__dirname, '..', '..');
const BILLING = fs.readFileSync(path.join(WWW, 'templates', 'billing.html'), 'utf8');
const css = (f) => fs.readFileSync(path.join(WWW, 'css', f), 'utf8');

const $ = (id) => document.getElementById(id);
const FIELDS = ['customerName', 'billItem', 'billRate', 'newWeight', 'saleCustomerName', 'saleItem', 'saleRate', 'saleWeight', 'billComments', 'saleComments'];
const rowOf = (id) => $(id).closest('.bill-entry-row');

beforeEach(async () => {
    document.body.innerHTML = `<main>${BILLING}</main>`;
    await setLang('en');
    localStorage.clear();
    delete window.webkitSpeechRecognition;
    PhotoWeights.setShared(undefined);
});

describe('floating labels (.field-float)', () => {
    test.each(FIELDS)('#%s has its own <label for> on the field, not a placeholder as label', (id) => {
        const field = $(id).closest('.field-float');
        expect(field).not.toBeNull();
        const label = field.querySelector(':scope > label');
        expect(label.htmlFor).toBe(id);
        expect(label.textContent.trim()).not.toBe('');
        expect(label.hidden).toBe(false);
        expect(label.classList.contains('sr-only')).toBe(false);
        expect(($(id).getAttribute('placeholder') || '').toLowerCase()).not.toBe(label.textContent.trim().toLowerCase());
    });

    test('a value leaves the label in place and visible', () => {
        document.head.innerHTML = `<style>${css('forms.css')}${css('billing.css')}</style>`;
        for (const id of ['customerName', 'billRate', 'newWeight']) {
            const label = $(id).closest('.field-float').querySelector(':scope > label');
            const before = label.outerHTML;
            $(id).value = id === 'customerName' ? 'Ramesh' : '22';
            $(id).dispatchEvent(new Event('input', { bubbles: true }));
            expect(label.isConnected).toBe(true);
            expect(label.outerHTML).toBe(before);
            const cs = getComputedStyle(label);
            expect(cs.display).not.toBe('none');
            expect(cs.visibility).not.toBe('hidden');
        }
    });

    test('no stylesheet moves or hides a floating label by whether the field is filled', () => {
        for (const f of fs.readdirSync(path.join(WWW, 'css')).filter((n) => n.endsWith('.css') && n !== 'app.css')) {
            const rules = css(f).replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter((r) => r.includes('field-float'));
            for (const r of rules) expect(`${f}: ${r}`).not.toMatch(/placeholder-shown|:valid|:invalid|display:\s*none|visibility:\s*hidden|opacity:\s*0[;\s]/);
        }
    });

    test('labels use --fs-label, which is at least 14 px (#68)', () => {
        expect(css('forms.css')).toMatch(/\.field-float > label \{[^}]*font-size: var\(--fs-label\)/);
        const px = Number(/--fs-label:\s*(\d+)px/.exec(css('variables.css'))[1]);
        expect(px).toBeGreaterThanOrEqual(14);
    });

    test('focus is drawn inside the border, so no ring crosses the label (NEW-20)', () => {
        const rule = /\.field-float :is\(input, select, textarea, \.input\):focus,\s*\.field-float :is\(input, select, textarea, \.input\):focus-visible \{([^}]*)\}/.exec(css('forms.css'));
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/outline: none;/);
        expect(rule[1]).toMatch(/box-shadow: var\(--focus-inset\);/);
        expect(css('variables.css')).toMatch(/--focus-inset: inset [^;]*var\(--focus-ring\);/);
        // Nothing outranks it with an outer ring on a floating-label control
        for (const f of fs.readdirSync(path.join(WWW, 'css')).filter((n) => n.endsWith('.css') && n !== 'app.css')) {
            const rules = css(f).replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter((r) => /field-float[^{]*:focus/.test(r));
            for (const r of rules) expect(`${f}: ${r}`).not.toMatch(/box-shadow:\s*var\(--focus\)|outline:\s*\d/);
        }
    });

    test('Hindi: every floating label and icon button is translated', async () => {
        await setLang('hi');
        applyTranslations(document);
        expect($('customerName').closest('.field-float').querySelector('label > [data-i18n="ui.billing.supplier_label"]').textContent).toBe(hi['ui.billing.supplier_label']);
        expect($('saleItem').closest('.field-float').querySelector('label').textContent).toBe(hi['ui.common.item_2']);
        expect($('newWeight').closest('.field-float').querySelector('label').textContent).toBe(hi['ui.billing.weight_label']);
        expect($('voiceMicPurchase').getAttribute('aria-label')).toBe(hi['ui.voice.mic']);
        expect(hi['ui.voice.mic']).toBe('बिल बोलें');
        expect($('voiceMicSale').title).toBe(hi['ui.voice.mic_title']);
        expect($('photoWeightsPurchase').getAttribute('aria-label')).toBe(hi['ui.photo_weights.button']);
        expect($('photoWeightsPurchase').title).toBe(hi['ui.photo_weights.button_title']);
        expect(document.querySelector('#purchaseSection .bill-line-form').getAttribute('aria-label')).toBe(hi['ui.billing.new_line']);
    });
});

describe('line entry rows', () => {
    test.each([
        ['purchase', 'customerName', 'billItem', 'billRate', 'voiceMicPurchase', 'newWeight', 'photoWeightsPurchase'],
        ['sale', 'saleCustomerName', 'saleItem', 'saleRate', 'voiceMicSale', 'saleWeight', null],
    ])('%s: Customer | 🎙, then Item | Rate, then Weight | 📷 | Add', (_mode, name, item, rate, mic, weight, cam) => {
        const section = $(name).closest('#purchaseSection, #saleSection');
        expect(section.querySelectorAll('[data-voice-mic]')).toHaveLength(1);
        expect(section.querySelectorAll('[data-voice-hold]')).toHaveLength(1);
        const top = $(name).closest('.bill-head');
        expect($(mic).parentElement).toBe(top);
        expect($(mic).previousElementSibling).toBe($(name).closest('.field-float'));
        expect($(mic).closest('.field-float')).toBeNull();
        expect($(mic).classList.contains('btn-tonal')).toBe(true);
        expect(rowOf(rate)).toBe(rowOf(item));
        expect([...rowOf(item).children].map(c => c.className)).toEqual(['field-float bill-entry-item', 'field-float bill-entry-rate']);
        expect(rowOf(item).querySelector('[data-voice-mic], button')).toBeNull();
        const row2 = rowOf(weight);
        expect(row2).not.toBe(rowOf(item));
        expect(row2.lastElementChild.matches('[data-add-weight]')).toBe(true);
        if (cam) expect($(cam).parentElement).toBe(row2);
        else expect(row2.querySelector('[data-photo-weights]')).toBeNull();
    });

    test('no "New line" heading; the line card is a named group', () => {
        expect(document.querySelector('[data-i18n="ui.billing.new_line"]')).toBeNull();
        for (const form of document.querySelectorAll('.bill-line-form')) {
            expect(form.getAttribute('role')).toBe('group');
            expect(form.getAttribute('aria-label')).toBe(en['ui.billing.new_line']);
        }
    });

    test('icon buttons have a name and a title in English', () => {
        for (const id of ['voiceMicPurchase', 'voiceMicSale']) {
            expect($(id).getAttribute('aria-label')).toBe('Speak the bill');
            expect($(id).title).toBe('Speak the bill');
            expect(en['ui.voice.mic']).toBe('Speak the bill');
        }
        expect($('photoWeightsPurchase').getAttribute('aria-label')).toBe(en['ui.photo_weights.button']);
    });

    test('the voice transcript sits right under Customer | 🎙', () => {
        expect($('voiceTranscriptPurchase').closest('.voice-strip').previousElementSibling).toBe($('customerName').closest('.bill-head'));
        expect($('voiceTranscriptSale').closest('.voice-strip').previousElementSibling).toBe($('saleCustomerName').closest('.bill-head'));
    });

    test('the name fields accept the keyboard\'s own voice typing: capitalised words, nothing that blocks it', () => {
        for (const id of ['customerName', 'saleCustomerName']) {
            expect($(id).getAttribute('autocapitalize')).toBe('words');
            expect($(id).readOnly).toBe(false);
            expect($(id).getAttribute('inputmode')).toBeNull();
        }
    });

    test('Notes is a floating-label field; "Print in bill" a check row under it, unticked by default', () => {
        for (const [note, print] of [['billComments', 'billPrintComments'], ['saleComments', 'salePrintComments']]) {
            const field = $(note).closest('.field-float');
            expect(field.querySelector(':scope > label').htmlFor).toBe(note);
            expect(field.contains($(print))).toBe(false);
            expect($(print).closest('.bill-note-print').previousElementSibling).toBe(field);
            expect($(print).checked).toBe(false);
        }
    });

    test('the contact button stays inside the name field', () => {
        for (const id of ['customerName', 'saleCustomerName']) {
            const btn = $(id).parentElement.querySelector('[data-onclick*="ontact"]');
            expect(btn).not.toBeNull();
            expect(btn.hidden).toBe(false);
            expect(btn.closest('.field-float')).toBe($(id).closest('.field-float'));
        }
    });
});

describe('🎙 only with Voice billing on, 📷 only with Photo of weights on', () => {
    const shown = (sel) => [...document.querySelectorAll(sel)].map((b) => !b.hidden);

    test('both off: no icon buttons, and the fields keep the whole row', () => {
        VoiceMic.apply();
        PhotoWeights.apply();
        expect(shown('[data-voice-mic]')).toEqual([false, false]);
        expect(shown('[data-photo-weights]')).toEqual([false]);
        expect(css('billing.css')).toMatch(/\.bill-entry-row > \.field-float \{[^}]*flex: 1 1 0/);
        expect(css('billing.css')).toMatch(/\.field-float\.bill-customer \{[^}]*flex: 1 1 0/);
    });

    test('voice on (with a speech engine): the 🎙 in both modes, no 📷', () => {
        window.webkitSpeechRecognition = function Rec() {};
        localStorage.setItem(VOICE_KEY, '1');
        VoiceMic.apply();
        PhotoWeights.apply();
        expect(shown('[data-voice-mic]')).toEqual([true, true]);
        expect(shown('[data-photo-weights]')).toEqual([false]);
        // One mic per form, beside Customer; none in the name field (the keyboard's own mic types a name)
        for (const [name, mic] of [['customerName', 'voiceMicPurchase'], ['saleCustomerName', 'voiceMicSale']]) {
            expect($(mic).previousElementSibling).toBe($(name).closest('.field-float'));
            expect($(name).closest('.field-float').querySelector('[data-voice-mic]')).toBeNull();
        }
    });

    test('Photo of weights on (a build with App Check): the 📷 beside Weight, no 🎙', () => {
        AppState.userRole = 'owner';
        window.APP_CHECK_SITE_KEY = 'site-key';
        PhotoWeights.setShared({ enabled: true });
        delete window.APP_CHECK_SITE_KEY;
        VoiceMic.apply();
        expect(shown('[data-voice-mic]')).toEqual([false, false]);
        expect(shown('[data-photo-weights]')).toEqual([true]);
        expect($('photoWeightsPurchase').parentElement).toBe(rowOf('newWeight'));
    });
});

describe('⋯ beside Purchase / Retail sale', () => {
    test('one row: the mode switch, then ⋯ holding Drafts, Save draft and Clear', () => {
        const row = document.querySelector('.bill-mode-row');
        expect(row.contains($('purchaseModeBtn'))).toBe(true);
        expect(row.lastElementChild).toBe($('billMenu'));
        for (const id of ['draftsBtn', 'saveDraftBtn', 'clearBillBtn']) expect($('billMenu').contains($(id))).toBe(true);
        expect(document.querySelector('.bill-toolbar')).toBeNull();
    });

    test('the badge on ⋯ counts the drafts and hides at 0', async () => {
        global.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };
        BillDrafts.countDrafts.mockResolvedValueOnce(3);
        await BillingManager.updateDraftCount();
        expect($('draftBadge').hidden).toBe(false);
        expect($('draftBadge').textContent).toBe('3');
        expect($('draftsBtn').hidden).toBe(false);
        BillDrafts.countDrafts.mockResolvedValueOnce(0);
        await BillingManager.updateDraftCount();
        expect($('draftBadge').hidden).toBe(true);
        expect($('draftsBtn').hidden).toBe(true);
        delete global.firebase;
    });
});

describe('one field style, and Billing\'s look on Wholesale (NEW-04, NEW-10)', () => {
    const tpl = (n) => fs.readFileSync(path.join(WWW, 'templates', n), 'utf8');
    const ENTRY = {
        'wholesale-sales.html': ['wholesaleCustomerName', 'sellItem', 'sellRate', 'sellQuantity'],
        'expenses.html': ['Type', 'Amount', 'Date', 'Mode', 'Person', 'Remarks'].flatMap(f => [`businessExpense${f}`, `personalExpense${f}`]),
        'cash-management.html': ['cashSignInAmount', 'cashSignInNotes', 'cashTransactionType', 'transactionAmount', 'partyName', 'dueBillSelect', 'transactionNotes', 'cashSignOutAmount', 'cashSignOutNotes']
    };

    test.each(Object.keys(ENTRY))('%s: every entry field is a .field-float with its own <label for>', (file) => {
        document.body.innerHTML = tpl(file);
        for (const id of ENTRY[file]) {
            const field = $(id).closest('.field-float');
            expect(field).not.toBeNull();
            expect(field.querySelector(':scope > label').htmlFor).toBe(id);
        }
        if (file !== 'wholesale-sales.html') expect(document.querySelectorAll('.field')).toHaveLength(0);
    });

    test('Wholesale reuses Billing\'s payment rows and action bar', () => {
        document.body.innerHTML = `<main>${BILLING}${tpl('wholesale-sales.html')}</main>`;
        const shape = (root) => ({
            pay: [...root.querySelectorAll('.bill-totals > .pay-line')].map(l => `${l.className}: ${[...l.children].map(c => c.className).join(' | ')}`),
            bar: [...root.querySelector('.bill-actions').children].map(c => c.className)
        });
        expect(shape($('salesEntrySection'))).toEqual(shape($('saleSection')));
        expect($('saveWholesaleBtn').className).toBe('btn bill-save');
        expect($('printWholesaleBtn').className).toBe('btn btn-primary bill-print');
    });

    test('violet (the wholesale mode colour) is only the mode dot: no Wholesale button, link or Fill takes it', () => {
        const all = fs.readdirSync(path.join(WWW, 'css')).filter(n => n.endsWith('.css') && n !== 'app.css' && !n.startsWith('variables'))
            .map(css).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(all).not.toMatch(/--bill-tone/);
        const selectors = all.split('}').filter(r => r.includes('var(--mode-wholesale') || r.includes('var(--on-mode-wholesale')).map(r => r.split('{')[0]);
        for (const s of selectors.filter(s => !/mode-dot|bill-bar-label::before/.test(s))) expect(s).not.toMatch(/bill-page|\.ws-|wholesale-sales|btn|pay-fill/);
        expect(all).toMatch(/\.bill-page \.bill-bar-label::before \{[^}]*background: var\(--mode-wholesale\)/);
    });
});describe('action row: Print (save and print) is the one primary', () => {
    const tpl = (n) => fs.readFileSync(path.join(WWW, 'templates', n), 'utf8');
    test.each([['saveBillBtn', 'printBillBtn'], ['saveSaleBtn', 'printSaleBtn'], ['saveWholesaleBtn', 'printWholesaleBtn']])('%s / %s', (save, print) => {
        document.body.innerHTML = `<main>${BILLING}${tpl('wholesale-sales.html')}</main>`;
        const row = $(save).closest('.bill-actions');
        expect(row.querySelectorAll('.btn-primary')).toHaveLength(1);
        expect($(print).classList.contains('btn-primary')).toBe(true);
        expect($(save).classList.contains('btn-primary')).toBe(false);
        expect(row.lastElementChild).toBe($(print));
        expect($(print).querySelector('use').getAttribute('href')).toBe('#i-printer');
        expect([$(save).dataset.kbd, $(print).dataset.kbd]).toEqual(['Ctrl S', 'Ctrl P']);
        expect(row.querySelector('.bill-share').classList.contains('btn-icon')).toBe(true);
        // The label is just "Print" (it still saves first); its name and tooltip say so
        expect($(print).querySelector('.bill-print-label').getAttribute('data-i18n')).toBe('ui.billing.print_btn');
        expect([$(print).getAttribute('data-i18n-aria-label'), $(print).getAttribute('data-i18n-title')]).toEqual(['ui.billing.save_print', 'ui.billing.save_print']);
        expect($(print).getAttribute('aria-label')).toBe('Save and print');
    });

    test('Save and Save & print share the row in equal widths', () => {
        expect(css('totals.css')).toMatch(/\.bill-actions > :is\(\.bill-save, \.bill-print\) \{[^}]*flex: 1 1 0/);
    });
});

describe('Rate\'s chevron is Item\'s, at the right edge', () => {
    test.each([['billItem', 'billRate'], ['saleItem', 'saleRate']])('%s / %s: the same chevron at the same offset from the right edge', (item, rate) => {
        document.head.innerHTML = `<style>${css('forms.css')}${css('billing.css')}</style>`;
        // One rule draws both chevrons (same gradient, size, colour and 14–19 px from the right edge)
        const rule = css('forms.css').replace(/\/\*[\s\S]*?\*\//g, '').split('}').find(r => r.includes('.input[data-pick-list] {') && r.includes('select:not([multiple])'));
        expect(rule).toMatch(/background-position: calc\(100% - 19px\) 50%, calc\(100% - 14px\) 50%;/);
        expect(rule).toMatch(/var\(--ink-3\)/);
        const selectors = rule.split('{')[0].split(',').map(s => s.trim()).filter(Boolean);
        expect(selectors.some(s => $(item).matches(s))).toBe(true);
        expect(selectors.some(s => $(rate).matches(s))).toBe(true);
        expect(getComputedStyle($(rate)).paddingRight).toBe('36px');
        // The rate box is the last thing in its field, so its right edge is the field's
        expect($(rate).parentElement.lastElementChild).toBe($(rate));
        expect($(rate).closest('.field-float').querySelector('.adorn').lastElementChild).toBe($(rate));
        expect($(rate).hasAttribute('data-pick-list')).toBe(true);
        expect($(rate).getAttribute('list')).toBeTruthy();
    });

    test('the browser\'s own list button is hidden (it sat after the text), and a tap anywhere opens the list', () => {
        expect(css('forms.css')).toMatch(/\.input\[data-pick-list\]::-webkit-calendar-picker-indicator,\s*\.input\[data-pick-list\]::-webkit-list-button \{\s*display: none;/);
        const picker = jest.fn();
        $('billRate').showPicker = picker;
        $('billRate').click();
        expect(picker).toHaveBeenCalledTimes(1);
    });
});
