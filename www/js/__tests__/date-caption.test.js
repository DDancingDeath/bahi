/**
 * @fileoverview F54: a native date box gets a caption in the app's one date format (formatDay).
 */
import { dateCaptionText, installDateCaptions, renderDateCaptions } from '../ui/date-caption.js';
import { setLang } from '../i18n/index.js';

const cap = (id) => document.getElementById(id).nextElementSibling;

describe('date captions', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    test('one box: "21 Nov 2026" under it, hidden while empty, kept current when a script or the user sets it', () => {
        document.body.innerHTML = '<div class="field"><label for="d">Date</label><input type="date" id="d" value="2026-11-21"></div>';
        renderDateCaptions();
        expect(cap('d').className).toBe('date-caption');
        expect(cap('d').textContent).toBe('21 Nov 2026');
        expect(cap('d').getAttribute('aria-hidden')).toBe('true');
        const input = document.getElementById('d');
        input.value = '';
        expect(cap('d').hidden).toBe(true);
        input.value = '2026-01-05';
        expect(cap('d').textContent).toBe('5 Jan 2026');
        expect(input.value).toBe('2026-01-05');
        renderDateCaptions();
        expect(document.querySelectorAll('.date-caption')).toHaveLength(1);
    });

    test('From – To boxes share one caption at the end of their row; the bill forms\' Date box has none', () => {
        document.body.innerHTML = `<div id="row"><input type="date" id="f" value="2026-11-01"><span>–</span><input type="date" id="t"><button>Apply</button></div>
            <div class="bill-date"><input type="date" id="billDate" class="bill-date-input" value="2026-11-21"></div>`;
        renderDateCaptions();
        const row = document.getElementById('row');
        expect(row.lastElementChild.className).toBe('date-caption date-caption--range');
        expect(row.lastElementChild.textContent).toBe('1 Nov 2026 – …');
        document.getElementById('t').value = '2026-11-21';
        expect(row.lastElementChild.textContent).toBe('1 Nov 2026 – 21 Nov 2026');
        expect(row.querySelectorAll('.date-caption')).toHaveLength(1);
        expect(document.querySelector('.bill-date .date-caption')).toBeNull();
    });

    test('in Hindi the month is Hindi; boxes added later are captioned', async () => {
        expect(dateCaptionText(['2026-11-21'], 'hi')).toBe('21 नवंबर 2026');
        expect(dateCaptionText(['', ''])).toBe('');
        installDateCaptions();
        document.body.insertAdjacentHTML('beforeend', '<input type="date" id="late" value="2026-03-02">');
        await new Promise(r => setTimeout(r, 0));
        expect(cap('late').textContent).toBe('2 Mar 2026');
        await setLang('hi');
        expect(cap('late').textContent).toBe('2 मार्च 2026');
        await setLang('en');
    });
});
