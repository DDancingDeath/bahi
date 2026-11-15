/**
 * @fileoverview Purchase / Retail sale line entry (option C): every field has a real <label> that floats on its
 * border and stays there with a value (.field-float, never a placeholder as label); Item | Rate | 🎙 and
 * Weight | 📷 | Add; the 🎙 shows only with Voice billing on, the 📷 only with Photo of weights on; the ⋯ menu
 * sits beside Purchase / Retail sale and holds Drafts with a count badge. Runs on the real billing.html.
 */
import fs from 'fs';
import path from 'path';
import { BillingManager } from '../modules/billing.js';
import * as BillDrafts from '../firebase/repos/bill-drafts.js';
import { VoiceMic, VOICE_KEY } from '../ui/voice-mic.js';
import { PhotoWeights } from '../ui/photo-weights.js';
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
const FIELDS = ['customerName', 'billItem', 'billRate', 'newWeight', 'saleCustomerName', 'saleItem', 'saleRate', 'saleWeight'];
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

    test('Hindi: every floating label and icon button is translated', async () => {
        await setLang('hi');
        applyTranslations(document);
        expect($('customerName').closest('.field-float').querySelector('label').textContent).toBe(hi['ui.billing.supplier_label']);
        expect($('saleItem').closest('.field-float').querySelector('label').textContent).toBe(hi['ui.common.item_2']);
        expect($('newWeight').closest('.field-float').querySelector('label').textContent).toBe(hi['ui.billing.weight_label']);
        expect($('voiceMicPurchase').getAttribute('aria-label')).toBe(hi['ui.voice.mic']);
        expect($('voiceMicSale').title).toBe(hi['ui.voice.mic_title']);
        expect($('photoWeightsPurchase').getAttribute('aria-label')).toBe(hi['ui.photo_weights.button']);
        expect($('photoWeightsPurchase').title).toBe(hi['ui.photo_weights.button_title']);
        expect(document.querySelector('#purchaseSection .bill-line-form').getAttribute('aria-label')).toBe(hi['ui.billing.new_line']);
    });
});

describe('line entry rows', () => {
    test.each([
        ['purchase', 'billItem', 'billRate', 'voiceMicPurchase', 'newWeight', 'photoWeightsPurchase'],
        ['sale', 'saleItem', 'saleRate', 'voiceMicSale', 'saleWeight', null],
    ])('%s: Item | Rate | 🎙, then Weight | 📷 | Add', (_mode, item, rate, mic, weight, cam) => {
        expect(rowOf(rate)).toBe(rowOf(item));
        expect($(mic).parentElement).toBe(rowOf(item));
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
            expect($(id).getAttribute('aria-label')).toBe(en['ui.voice.mic']);
            expect($(id).title).toBe(en['ui.voice.mic_title']);
        }
        expect($('photoWeightsPurchase').getAttribute('aria-label')).toBe(en['ui.photo_weights.button']);
    });

    test('the voice transcript sits right under Item | Rate | 🎙', () => {
        expect($('voiceTranscriptPurchase').closest('.voice-strip').previousElementSibling).toBe(rowOf('billItem'));
        expect($('voiceTranscriptSale').closest('.voice-strip').previousElementSibling).toBe(rowOf('saleItem'));
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
    });

    test('voice on (with a speech engine): the 🎙 in both modes, no 📷', () => {
        window.webkitSpeechRecognition = function Rec() {};
        localStorage.setItem(VOICE_KEY, '1');
        VoiceMic.apply();
        PhotoWeights.apply();
        expect(shown('[data-voice-mic]')).toEqual([true, true]);
        expect(shown('[data-photo-weights]')).toEqual([false]);
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
