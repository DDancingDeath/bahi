/**
 * @fileoverview Numbers typed in the bill forms (U-84, U-29): Hindi keyboard digits and Indian
 * commas read as the number, amount boxes show Indian grouping when left, and a Hindi digit typed
 * into a number box goes in as 0–9 instead of emptying it.
 */
import { groupIndianText, hasDevanagariDigit, normalizeNumberText, parseNumberText } from '../utils/number-text.js';
import { showAmount } from '../ui/number-input.js';
import { Helpers } from '../utils/helpers.js';

describe('reading typed numbers', () => {
    test.each([
        ['१२३', 123],
        ['१,२५,०००', 125000],
        ['1,25,000.50', 125000.5],
        ['₹ 2,400', 2400],
        ['२४.५', 24.5],
        ['', NaN],
        ['abc', NaN]
    ])('%s → %s', (text, n) => {
        expect(parseNumberText(text)).toEqual(n);
    });

    test('Helpers.getInputNumber reads Hindi digits and commas', () => {
        document.body.innerHTML = '<input id="a" value="१,२०,५००"><input id="b" value="">';
        expect(Helpers.getInputNumber('a')).toBe(120500);
        expect(Helpers.getInputNumber('b', 7)).toBe(7);
        expect(normalizeNumberText('०९')).toBe('09');
        expect(hasDevanagariDigit('12')).toBe(false);
    });
});

describe('Indian grouping', () => {
    test.each([
        ['125000', '1,25,000'],
        ['12345678', '1,23,45,678'],
        ['999', '999'],
        ['1000', '1,000'],
        ['16191.5', '16,191.5'],
        ['-2500', '-2,500'],
        ['1,25,000', '1,25,000'],
        ['', ''],
        ['abc', 'abc']
    ])('%s → %s', (text, shown) => {
        expect(groupIndianText(text)).toBe(shown);
    });

    test('an amount box shows grouping when left and plain digits while typed in', () => {
        document.body.innerHTML = '<input id="cash" type="text" inputmode="decimal" data-money><input id="w" type="number">';
        const cash = document.getElementById('cash');
        showAmount(cash, 16191);
        expect(cash.value).toBe('16,191');
        cash.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(cash.value).toBe('16191');
        cash.value = '125000';
        cash.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        expect(cash.value).toBe('1,25,000');
        expect(Helpers.getInputNumber('cash')).toBe(125000);
        showAmount(document.getElementById('w'), 1500);
        expect(document.getElementById('w').value).toBe('1500');
    });

    test('a Hindi digit typed into a box goes in as 0–9', () => {
        document.body.innerHTML = '<input id="cash" type="text" inputmode="decimal" data-money value="1">';
        const cash = document.getElementById('cash');
        cash.setSelectionRange(1, 1);
        const onInput = jest.fn();
        cash.addEventListener('input', onInput);
        const e = new InputEvent('beforeinput', { data: '२५', inputType: 'insertText', bubbles: true, cancelable: true });
        cash.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
        expect(cash.value).toBe('125');
        expect(onInput).toHaveBeenCalled();
    });
});
