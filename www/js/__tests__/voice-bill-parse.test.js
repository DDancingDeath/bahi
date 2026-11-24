/**
 * @fileoverview Whole-bill voice (#498): one or several things said, in any order, sorted
 * into the parts of the Billing page, and the check sheet's running bill across holds.
 */
import { parseWholeBill, pickWholeBill, mergeWholeBill, hasWholeBillValues } from '../utils/voice-bill-parse.js';

const ITEMS = [
    { id: 'w', name: 'Wheat', hindiName: 'गेहूं', rates: [24] },
    { id: 'r', name: 'Rice', hindiName: 'चावल', rates: [30] },
    { id: 'a', name: 'Aloo', hindiName: 'आलू' }
];
const KILO = '\u0915\u093F\u0932\u094B';
const parse = (text) => parseWholeBill(text, ITEMS);
const lines = (b) => b.lines.map(({ itemIndex, weight, rate }) => [itemIndex, weight, rate]);
const NO_PAY = { cash: null, online: null, due: null, rest: null, full: null };

describe('party', () => {
    test.each([
        ['Ramesh se gehun 10 kilo 25', 'Ramesh', 'supplier'],
        ['from Ramesh, wheat 10 kg 25', 'Ramesh', 'supplier'],
        ['supplier Ramesh bhai', 'Ramesh Bhai', 'supplier'],
        ['customer Ramesh', 'Ramesh', 'customer'],
        ['Ramesh ko 5 kilo chawal 30', 'Ramesh', 'customer'],
        ['Suresh ke liye chawal 5 kilo 30', 'Suresh', 'customer'],
        [`रमेश से गेहूं 10 ${KILO} 25 रुपये`, 'रमेश', 'supplier'],
        [`ग्राहक का नाम सुरेश, चावल 5 ${KILO} 30`, 'सुरेश', 'customer'],
        [`सुरेश को चावल 5 ${KILO} 30`, 'सुरेश', 'customer']
    ])('%s → %s (%s)', (text, name, role) => {
        expect(parse(text).party).toEqual({ spoken: name, role });
    });

    test('a unit, number or item before "se" is not a name', () => {
        expect(parse('10 kilo se').party).toBeNull();
        expect(parse('wheat se 10 kg 24').party).toBeNull();
    });
});

describe('lines', () => {
    test('several lines with "aur", commas and Hindi item names said in Latin letters', () => {
        expect(lines(parse('gehun 10 kilo 25 rupaye, chawal 5 kilo 30'))).toEqual([[0, 10, 25], [1, 5, 30]]);
        expect(lines(parse('wheat 10 kg 24 aur rice 5 kg 30 and wheat 2 kg 25'))).toEqual([[0, 10, 24], [1, 5, 30], [0, 2, 25]]);
        expect(lines(parse(`गेहूं 10 ${KILO} 25 रुपये और चावल 5 ${KILO} 30`))).toEqual([[0, 10, 25], [1, 5, 30]]);
    });

    test('bag weights: each bag, the kg added up, and the rate', () => {
        const [line] = parse('wheat bags 23, 24.5, 22 at 25').lines;
        expect(line).toMatchObject({ itemIndex: 0, weights: [23, 24.5, 22], weight: 69.5, rate: 25 });
        expect(parse('gehun bori 50, 52 rate 24').lines[0]).toMatchObject({ itemIndex: 0, weights: [50, 52], weight: 102, rate: 24 });
        // "5 bags" is a count, not weights
        expect(parse('wheat 5 bags 24').lines[0].weights).toBeUndefined();
    });

    test('"rate 26" alone is a rate for the line, not a line', () => {
        const b = parse('rate 26');
        expect([b.lines, b.rate]).toEqual([[], 26]);
    });

    test('"25 के जी" (kg spelt out by the Hindi recogniser) is a weight; "30 के" is still a rate', () => {
        for (const said of ['25 के जी', '25 के.जी.', 'गेहूं 25 के जी']) {
            const b = parse(said);
            expect([said, b.lines.map(l => [l.weight, l.rate]), b.rate]).toEqual([said, [[25, null]], null]);
        }
        expect(lines(parse('गेहूं 10 के जी 30 के'))).toEqual([[0, 10, 30]]);
        expect(parse('25 के जीरा').lines.map(l => l.weight)).not.toEqual([25]);
    });
});

describe('payment', () => {
    test.each([
        ['cash 500', { cash: 500 }],
        ['500 cash', { cash: 500 }],
        ['nakad 500', { cash: 500 }],
        ['नकद 500', { cash: 500 }],
        ['online 1000', { online: 1000 }],
        ['upi 300', { online: 300 }],
        ['phone pe 300', { online: 300 }],
        ['google pay 300', { online: 300 }],
        ['paytm 250', { online: 250 }],
        ['udhaar 200', { due: 200 }],
        ['baaki udhaar', { rest: 'due' }],
        ['rest due', { rest: 'due' }],
        ['baad mein', { rest: 'due' }],
        ['बाकी उधार', { rest: 'due' }],
        ['baaki cash', { rest: 'cash' }],
        ['pura cash', { full: 'cash' }],
        ['full cash', { full: 'cash' }],
        ['pura online', { full: 'online' }],
        ['cash 500 aur online 300 baaki udhaar', { cash: 500, online: 300, rest: 'due' }]
    ])('%s', (text, pay) => {
        const b = parse(text);
        expect(b.payment).toEqual({ ...NO_PAY, ...pay });
        expect(b.lines).toEqual([]);
    });

    test('a rate before "cash" stays the line\'s rate', () => {
        const b = parse('chawal 5 kilo 30, cash 500');
        expect(lines(b)).toEqual([[1, 5, 30]]);
        expect(b.payment.cash).toBe(500);
    });
});

describe('labour, note, date', () => {
    test.each([
        ['labour 60', { on: true, amount: 60, perBag: null }],
        ['majdoori 60', { on: true, amount: 60, perBag: null }],
        ['labour 6 per bag', { on: true, amount: null, perBag: 6 }],
        ['labour charge band', { on: false, amount: null, perBag: null }],
        ['labour off', { on: false, amount: null, perBag: null }],
        ['labour nahi', { on: false, amount: null, perBag: null }],
        ['no labour', { on: false, amount: null, perBag: null }],
        ['मज़दूरी बंद', { on: false, amount: null, perBag: null }],
        ['labour on', { on: true, amount: null, perBag: null }]
    ])('%s', (text, labour) => {
        expect(parse(text).labour).toEqual(labour);
    });

    test('a note keeps its words as said, to the end', () => {
        const b = parse('wheat 10 kg 24, note GPay name Mohan, 2 bags');
        expect(b.note).toBe('GPay name Mohan, 2 bags');
        expect(lines(b)).toEqual([[0, 10, 24]]);
    });

    test.each([['kal ka bill', 1], ['yesterday', 1], ['parso', 2], ['3 din pehle', 3], ['aaj', 0]])('date: %s', (text, daysAgo) => {
        expect(parse(text).date).toEqual({ daysAgo });
    });

    test('words that fit nowhere are kept as not understood', () => {
        const b = parse('hello there, cash 100');
        expect(b.unclear).toEqual(['hello there']);
        expect(b.payment.cash).toBe(100);
        expect(hasWholeBillValues(parse('hello there'))).toBe(false);
    });
});

test('the whole page in one go', () => {
    const b = parse('Ramesh se gehun 10 kilo 25 rupaye aur chawal 5 kilo 30, labour 20, cash 100, baaki udhaar, note truck wala');
    expect(b.party).toEqual({ spoken: 'Ramesh', role: 'supplier' });
    expect(lines(b)).toEqual([[0, 10, 25], [1, 5, 30]]);
    expect(b.labour).toEqual({ on: true, amount: 20, perBag: null });
    expect(b.payment).toEqual({ ...NO_PAY, cash: 100, rest: 'due' });
    expect(b.note).toBe('truck wala');
    expect(b.unclear).toEqual([]);
});

test('the best of the recogniser\'s alternatives', () => {
    expect(lines(pickWholeBill(['hello', 'wheat 10 kg 24'], ITEMS))).toEqual([[0, 10, 24]]);
});

describe('the check sheet across holds', () => {
    test('each hold adds; a later party, leg or labour replaces; "rate" goes to the last line', () => {
        let acc = mergeWholeBill(null, parse('customer Ramesh'));
        acc = mergeWholeBill(acc, parse('gehun 10 kilo 25'));
        acc = mergeWholeBill(acc, parse('cash 500'));
        acc = mergeWholeBill(acc, parse('chawal 5 kilo'));
        acc = mergeWholeBill(acc, parse('rate 30'));
        acc = mergeWholeBill(acc, parse('online 300'));
        acc = mergeWholeBill(acc, parse('cash 400'));
        acc = mergeWholeBill(acc, parse('labour 60'));
        acc = mergeWholeBill(acc, parse('labour band'));
        acc = mergeWholeBill(acc, parse('baaki udhaar'));
        expect(acc.party.spoken).toBe('Ramesh');
        expect(lines(acc)).toEqual([[0, 10, 25], [1, 5, 30]]);
        expect(acc.payment).toEqual({ ...NO_PAY, cash: 400, online: 300, rest: 'due' });
        expect(acc.labour).toEqual({ on: false, amount: null, perBag: null });
        expect(acc.heardAll).toHaveLength(10);
    });

    test('"rate" with no line yet is kept for the line in the form; "pura cash" replaces the legs', () => {
        let acc = mergeWholeBill(null, parse('rate 26'));
        expect(acc.rate).toBe(26);
        acc = mergeWholeBill(acc, parse('cash 500 online 200'));
        acc = mergeWholeBill(acc, parse('pura cash'));
        expect(acc.payment).toEqual({ ...NO_PAY, full: 'cash' });
    });
});
