/**
 * @fileoverview F54: every date box shows its day as formatDay writes it, over the native box's own text.
 */
import { dateFieldText, installDateFields, renderDateFields } from '../ui/date-field.js';
import { setLang } from '../i18n/index.js';

const shown = (id) => document.getElementById(id).parentElement.querySelector('.date-field-text');

describe('date fields', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    test('the box shows "21 Nov 2026" (not 11/21/2026), kept current when a script or the user sets it', () => {
        document.body.innerHTML = '<div class="field-float"><label for="d">Date</label><input type="date" class="input" id="d" value="2026-11-21"></div>';
        renderDateFields();
        const input = document.getElementById('d');
        expect(input.parentElement.className).toBe('date-field');
        expect(input.parentElement.parentElement.querySelector('label').htmlFor).toBe('d');
        expect(shown('d').textContent).toBe('21 Nov 2026');
        expect(shown('d').getAttribute('aria-hidden')).toBe('true');
        input.value = '2026-01-05';
        expect(shown('d').textContent).toBe('5 Jan 2026');
        expect(input.value).toBe('2026-01-05');
        input.value = '';
        expect(shown('d').textContent).toBe('Pick a day');
        expect(shown('d').classList.contains('date-field-empty')).toBe(true);
        renderDateFields();
        expect(document.querySelectorAll('.date-field')).toHaveLength(1);
    });

    test('the bill forms\' Date box and From – To boxes each show their day; data-native-date is left alone', () => {
        document.body.innerHTML = `<div id="row"><input type="date" id="f" value="2026-11-01"><span>–</span><input type="date" id="t"></div>
            <div class="bill-date"><input type="date" id="billDate" class="bill-date-input" value="2026-11-21"></div>
            <input type="date" id="raw" data-native-date value="2026-11-21">`;
        renderDateFields();
        expect(shown('f').textContent).toBe('1 Nov 2026');
        expect(shown('t').textContent).toBe('Pick a day');
        expect(shown('billDate').textContent).toBe('21 Nov 2026');
        expect(document.getElementById('raw').parentElement.classList.contains('date-field')).toBe(false);
    });

    test('Enter opens the picker; typing digits shows the box\'s own fields until it loses focus', () => {
        document.body.innerHTML = '<input type="date" id="k" value="2026-11-21">';
        renderDateFields();
        const input = document.getElementById('k');
        input.showPicker = jest.fn();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(input.showPicker).toHaveBeenCalledTimes(1);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
        expect(input.parentElement.classList.contains('date-field--typing')).toBe(true);
        input.dispatchEvent(new Event('blur'));
        expect(input.parentElement.classList.contains('date-field--typing')).toBe(false);
        input.disabled = true;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
        expect(input.showPicker).toHaveBeenCalledTimes(1);
    });

    test('in Hindi the month is Hindi; boxes added later get the day too', async () => {
        expect(dateFieldText('2026-11-21', 'hi')).toBe('21 नवंबर 2026');
        expect(dateFieldText('')).toBe('');
        installDateFields();
        document.body.insertAdjacentHTML('beforeend', '<input type="date" id="late" value="2026-03-02">');
        await new Promise(r => setTimeout(r, 0));
        expect(shown('late').textContent).toBe('2 Mar 2026');
        await setLang('hi');
        expect(shown('late').textContent).toBe('2 मार्च 2026');
        await setLang('en');
    });

    test('a box added and focused at once keeps its focus when it is wrapped', async () => {
        installDateFields();
        document.body.insertAdjacentHTML('beforeend', '<input type="date" id="focused" value="2026-03-02">');
        document.getElementById('focused').focus();
        await new Promise(r => setTimeout(r, 0));
        expect(document.getElementById('focused').parentElement.className).toBe('date-field');
        expect(document.activeElement.id).toBe('focused');
    });
});
