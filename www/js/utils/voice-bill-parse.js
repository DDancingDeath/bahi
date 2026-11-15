// @ts-check
/**
 * @fileoverview Whole-bill voice (#498): one or several things said, in any order, sorted
 * into the parts of the Billing page: the party ("Ramesh se", "customer Ramesh", "Ramesh ko"),
 * bill lines (utils/voice-parse.js, VB-1), bag weights ("wheat bags 23, 24.5, 22 at 25"),
 * a rate for the last line ("rate 26"), the payment ("cash 500", "online 300", "baaki
 * udhaar", "pura cash"), labour ("labour 60", "labour 6 per bag", "labour band"), a note
 * ("note …") and the day ("kal"). Values are as heard; nothing is worked out here except
 * a bag list's kg. Pure: no DOM, AppState or speech API.
 * @module utils/voice-bill-parse
 */

import {
    parseVoiceBill, parseVoiceLine, hasVoiceValues, isUnusualRate, voiceTokens,
    VOICE_WORDS, voiceNfc, voiceNumberGroups, voiceItemSpans, voiceNameCase
} from './voice-parse.js';
import { autoLabour, computeLine } from './calc/billing.js';
import { sumMoney } from './money.js';

const { WEIGHT_UNITS, PRICE_AFTER, RATE_WORDS, CURRENCY_BEFORE, PER_WORDS, POSSESSIVE,
    CUSTOMER_WORDS, NOT_ITEM_WORDS, LINE_SEPARATORS, NAME_FILLER, NAME_END, BREAK } = VOICE_WORDS;

const words = (/** @type {string[]} */ list) => new Set(list.map(voiceNfc));

/** Two spoken words read as one ("phone pe", "baad mein"). */
const JOINED = new Map(/** @type {Array<[string, string]>} */ ([
    ['phone pe', 'phonepe'], ['phone pay', 'phonepe'], ['google pay', 'gpay'], ['g pay', 'gpay'], ['gee pay', 'gpay'],
    ['baad mein', 'baadmein'], ['baad me', 'baadmein'], ['बाद में', 'बादमें'], ['फोन पे', 'फोनपे'], ['गूगल पे', 'जीपे'],
    ['labour charge', 'labour'], ['labour charges', 'labour'], ['labor charge', 'labour'], ['लेबर चार्ज', 'लेबर'],
    ['day before', 'parso'], ['दिन पहले', 'दिनपहले'], ['din pehle', 'dinpehle'], ['days ago', 'dinpehle'], ['day ago', 'dinpehle']
].map(([k, v]) => [voiceNfc(k), voiceNfc(v)])));

const CASH = words(['cash', 'nakad', 'nagad', 'naqad', 'nakd', 'कैश', 'नकद', 'नगद', 'नक़द', 'केश']);
const ONLINE = words(['online', 'upi', 'phonepe', 'gpay', 'paytm', 'bank', 'ऑनलाइन', 'आनलाइन', 'ओनलाइन', 'यूपीआई', 'फोनपे', 'जीपे', 'पेटीएम']);
const DUE = words(['udhaar', 'udhar', 'udhari', 'udhaari', 'due', 'credit', 'baadmein', 'later', 'उधार', 'उधारी', 'बादमें']);
const REST = words(['baaki', 'baki', 'bakaya', 'rest', 'remaining', 'balance', 'bacha', 'bache', 'बाकी', 'बाक़ी', 'बचा', 'बचे', 'बकाया']);
const FULL = words(['pura', 'poora', 'pure', 'poore', 'puri', 'full', 'sab', 'saara', 'sara', 'sare', 'whole', 'all', 'पूरा', 'पूरे', 'पूरी', 'सब', 'सारा', 'सारे']);
/** Between a payment word and its amount: "cash mein 500", "online se 300", "cash ₹500". */
const PAY_FILLER = words(['me', 'mein', 'mai', 'se', 'ka', 'ke', 'ki', 'of', 'in', 'by', 'diya', 'diye', 'di', 'mila', 'mile', 'paid', 'received', 'liya', 'liye',
    'में', 'से', 'का', 'के', 'की', 'दिया', 'दिए', 'दी', 'मिला', 'मिले', 'लिया', 'लिए', '₹', 'rs', 'payment']);

const LABOUR = words(['labour', 'labor', 'labours', 'majdoori', 'mazdoori', 'majduri', 'mazduri', 'hammali', 'hamali', 'palledari',
    'लेबर', 'मजदूरी', 'मज़दूरी', 'हम्माली', 'पल्लेदारी']);
const LABOUR_FILLER = words(['charge', 'charges', 'ka', 'ki', 'ke', 'kharcha', 'चार्ज', 'का', 'की', 'के', 'खर्चा', '₹', 'rs']);
const OFF = words(['off', 'band', 'bandh', 'nahi', 'nahin', 'na', 'no', 'mat', 'hatao', 'hata', 'without', 'bina', 'zero',
    'बंद', 'नहीं', 'ना', 'मत', 'हटाओ', 'हटा', 'बिना']);
const ON = words(['on', 'chalu', 'lagao', 'laga', 'lagaao', 'haan', 'yes', 'चालू', 'लगाओ', 'लगा', 'हां', 'हाँ']);
const BAG = words(['bag', 'bags', 'bori', 'boriya', 'boriyan', 'bore', 'katta', 'katte', 'packet', 'packets', 'weights', 'weight', 'vajan', 'wajan', 'dhada',
    'बोरी', 'बोरियां', 'बोरियाँ', 'कट्टा', 'कट्टे', 'पैकेट', 'वजन', 'वज़न']);

const NOTE_WORDS = ['note', 'notes', 'remark', 'नोट', 'टिप्पणी'];
const NOTE_RE = new RegExp(`(?:^|[\\s,.;\\u0964])(${NOTE_WORDS.join('|')})(?=[\\s:,-]|$)\\s*[:,-]?\\s*`, 'iu');

const TODAY = words(['aaj', 'today', 'आज']);
const YESTERDAY = words(['kal', 'yesterday', 'कल']);
const DAY_BEFORE = words(['parso', 'parson', 'parsoon', 'परसों', 'परसो']);
const DAYS_AGO = words(['dinpehle', 'दिनपहले']);
const DATE_FILLER = words(['ki', 'ka', 'ke', 'date', 'tarikh', 'taarikh', 'tareekh', 'bill', 'का', 'की', 'के', 'तारीख', 'तारीख़', 'yesterday\'s', 'dated']);

/** Before a party's name: "supplier Ramesh", "from Ramesh", "customer Ramesh" (with the older #81 A3 words). */
const PARTY_BEFORE = new Set([...CUSTOMER_WORDS, ...words(['supplier', 'from', 'seller', 'farmer', 'vyapari', 'सप्लायर', 'व्यापारी'])]);
const SUPPLIER_WORDS = words(['supplier', 'from', 'seller', 'farmer', 'kisan', 'kisaan', 'vyapari', 'सप्लायर', 'किसान', 'व्यापारी']);
/** After a name: "Ramesh se" (bought from), "Ramesh ko" (sold to). */
const PARTY_AFTER = new Map(/** @type {Array<[string, string]>} */ ([['se', 'supplier'], ['से', 'supplier'], ['ko', 'customer'], ['को', 'customer']]));
const NAME_MAX_WORDS = 3;

/** Words that belong to some other part of the bill, so never to a name. */
const KEYWORDS = new Set([...CASH, ...ONLINE, ...DUE, ...REST, ...FULL, ...LABOUR, ...OFF, ...ON, ...BAG, ...TODAY, ...YESTERDAY,
    ...DAY_BEFORE, ...DAYS_AGO, ...PARTY_BEFORE, ...words(['rate', 'bhav', 'भाव', 'रेट'])]);

const isNumberWord = (/** @type {string} */ w) => voiceNumberGroups([w]).length > 0;
const round3 = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;

/**
 * @typedef {{value: number, start: number, end: number}} NumGroup
 * @typedef {ReturnType<typeof parseVoiceLine> & {weights?: number[]}} VoiceLine
 * @typedef {{cash: ?number, online: ?number, due: ?number, rest: ?('cash'|'online'|'due'), full: ?('cash'|'online'|'due')}} VoicePayment
 * @typedef {{on: boolean, amount: ?number, perBag: ?number}} VoiceLabour
 * @typedef {{
 *   heard: string, party: ?{spoken: string, role: ?string}, lines: VoiceLine[], rate: ?number,
 *   payment: VoicePayment, labour: ?VoiceLabour, note: ?string, date: ?{daysAgo: number}, unclear: string[]
 * }} WholeBill
 */

/** Tokens with a BREAK where the text had a comma, full stop or । (as parseVoiceBill reads them), word pairs joined. */
function billTokens(/** @type {string} */ text) {
    /** @type {string[]} */
    const raw = [];
    String(text || '').split(/[;।|\n]|,(?!\d{3}(?!\d))|\.(?!\d)/).forEach((piece, p) => {
        if (p > 0) raw.push(BREAK);
        raw.push(...voiceTokens(piece));
    });
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i < raw.length; i++) {
        const pair = JOINED.get(`${raw[i]} ${raw[i + 1]}`);
        if (pair) {
            out.push(pair);
            i++;
        } else out.push(raw[i]);
    }
    return out;
}

/**
 * Parses one utterance into the parts of a bill.
 * @param {string} text
 * @param {Array<Rec>} items AppState.items
 * @param {{knownNames?: string[]}} [opts]
 * @returns {WholeBill}
 */
export function parseWholeBill(text, items = [], { knownNames = [] } = {}) {
    const heard = String(text || '').trim();
    /** @type {WholeBill} */
    const bill = {
        heard, party: null, lines: [], rate: null,
        payment: { cash: null, online: null, due: null, rest: null, full: null }, labour: null, note: null, date: null, unclear: []
    };
    let body = heard;
    const noteAt = NOTE_RE.exec(heard);
    if (noteAt) {
        bill.note = heard.slice(noteAt.index + noteAt[0].length).trim() || null;
        body = heard.slice(0, noteAt.index);
    }
    const tokens = billTokens(body);
    const used = tokens.map(w => w === BREAK);
    const take = (/** @type {number} */ from, /** @type {number} */ to) => { for (let k = from; k < to; k++) used[k] = true; };
    const groups = voiceNumberGroups(tokens).filter(g => g.value >= 0);
    const groupAt = (/** @type {number} */ start) => groups.find(g => g.start === start && !used[g.start]);
    const groupEndingAt = (/** @type {number} */ end) => groups.find(g => g.end === end && !used[g.start]);
    const clauseStart = (/** @type {number} */ k) => k <= 0 || tokens[k - 1] === BREAK || used[k - 1] || LINE_SEPARATORS.has(tokens[k - 1]);
    const spans = voiceItemSpans(tokens, items);

    bagLines(tokens, used, groups, spans, items).forEach(l => bill.lines.push(l));
    takeDate(tokens, used, groups, bill);
    takeLabour(tokens, used, take, groupAt, groupEndingAt, clauseStart, bill);
    takePayments(tokens, used, take, groupAt, groupEndingAt, clauseStart, bill);
    takeParty(tokens, used, take, spans, bill);

    // What is left: bill lines, a lone "rate 26", or words not understood
    /** @type {string[][]} */
    const pieces = [[]];
    tokens.forEach((w, k) => {
        if (used[k] || w === BREAK) {
            if (pieces[pieces.length - 1].length) pieces.push([]);
        } else pieces[pieces.length - 1].push(w);
    });
    const rest = pieces.filter(p => p.length);
    const fillers = new Set([...LINE_SEPARATORS, ...NAME_END, ...NAME_FILLER, ...words(['please', 'bhai', 'ji', 'और', 'bas', 'बस', 'ok', 'okay'])]);
    const meaningful = rest.filter(p => p.some(w => !fillers.has(w)));
    if (meaningful.length) {
        const parsed = parseVoiceBill(meaningful.map(p => p.join(' ')).join(', '), items, knownNames);
        if (!bill.party && parsed.customer) bill.party = { spoken: parsed.customer, role: null };
        for (const line of parsed.lines) {
            if (line.itemIndex === null && line.weight === null && line.rate !== null && !line.extraNumbers) bill.rate = line.rate;
            else if (hasVoiceValues(line)) bill.lines.push(line);
        }
        meaningful.forEach(p => {
            const one = parseVoiceLine(p.join(' '), items);
            if (!hasVoiceValues(one) && !(parsed.customer && p.join(' ').includes(parsed.customer.toLowerCase()))) bill.unclear.push(p.join(' '));
        });
    }
    return bill;
}

/** "wheat bags 23, 24.5, 22 at 25": the item, each bag's kg and the rate. */
function bagLines(/** @type {string[]} */ tokens, /** @type {boolean[]} */ used, /** @type {Array<{value: number, start: number, end: number}>} */ groups,
    /** @type {Array<{index: number, start: number, end: number}>} */ spans, /** @type {Array<Rec>} */ items) {
    /** @type {VoiceLine[]} */
    const out = [];
    const between = new Set([BREAK, ...LINE_SEPARATORS, ...WEIGHT_UNITS, ...words(['plus', '+'])]);
    for (let b = 0; b < tokens.length; b++) {
        if (used[b] || !BAG.has(tokens[b])) continue;
        // "5 bags": a count, not weights
        if (groups.some(g => g.end === b)) continue;
        /** @type {number[]} */
        const kgs = [];
        /** @type {?number} */
        let rate = null;
        let k = b + 1;
        while (k < tokens.length && (POSSESSIVE.has(tokens[k]) || tokens[k] === 'of')) k++;
        let end = b + 1;
        for (;;) {
            while (k < tokens.length && between.has(tokens[k]) && !groups.some(g => g.start === k)) k++;
            if (k < tokens.length && (RATE_WORDS.has(tokens[k]) || CURRENCY_BEFORE.has(tokens[k]))) {
                let r = k + 1;
                while (r < tokens.length && CURRENCY_BEFORE.has(tokens[r])) r++;
                const g = groups.find(x => x.start === r);
                if (g) {
                    rate = g.value;
                    end = g.end;
                    while (end < tokens.length && (PRICE_AFTER.has(tokens[end]) || PER_WORDS.has(tokens[end]) || WEIGHT_UNITS.has(tokens[end]))) end++;
                }
                break;
            }
            const g = groups.find(x => x.start === k);
            if (!g) break;
            if (PRICE_AFTER.has(tokens[g.end]) && !POSSESSIVE.has(tokens[g.end])) {
                rate = g.value;
                end = g.end + 1;
                break;
            }
            kgs.push(g.value);
            k = g.end;
            end = g.end;
            while (end < tokens.length && WEIGHT_UNITS.has(tokens[end])) end++;
        }
        if (kgs.length === 0) continue;
        const span = [...spans].reverse().find(s => s.end <= b && tokens.slice(s.end, b).every(w => POSSESSIVE.has(w) || w === 'of'));
        const start = span ? span.start : b;
        for (let x = start; x < end; x++) used[x] = true;
        const itemIndex = span ? span.index : null;
        const weight = round3(kgs.reduce((a, n) => a + n, 0));
        out.push({
            itemIndex, weight, weights: kgs, rate, extraNumbers: false,
            rateUnusual: rate !== null && itemIndex !== null && isUnusualRate(rate, items[itemIndex]),
            heard: tokens.slice(start, end).filter(w => w !== BREAK).join(' ')
        });
        b = end - 1;
    }
    return out;
}

/** "kal", "yesterday", "parso", "3 din pehle" (whether it may be used is the page's call). */
function takeDate(/** @type {string[]} */ tokens, /** @type {boolean[]} */ used, /** @type {Array<{value: number, start: number, end: number}>} */ groups, /** @type {WholeBill} */ bill) {
    for (let i = 0; i < tokens.length; i++) {
        if (used[i]) continue;
        const w = tokens[i];
        let daysAgo = null;
        let from = i;
        if (TODAY.has(w)) daysAgo = 0;
        else if (YESTERDAY.has(w)) daysAgo = 1;
        else if (DAY_BEFORE.has(w)) {
            daysAgo = 2;
            if (tokens[i + 1] === 'yesterday') used[i + 1] = true;
        } else if (DAYS_AGO.has(w)) {
            const g = groups.find(x => x.end === i && !used[x.start]);
            if (!g || g.value > 62 || g.value !== Math.round(g.value)) continue;
            daysAgo = g.value;
            from = g.start;
        }
        if (daysAgo === null) continue;
        let to = i + 1;
        while (to < tokens.length && DATE_FILLER.has(tokens[to])) to++;
        while (from > 0 && DATE_FILLER.has(tokens[from - 1]) && !used[from - 1]) from--;
        for (let k = from; k < to; k++) used[k] = true;
        bill.date = { daysAgo };
    }
}

/** "labour 60", "labour 6 per bag", "labour band" / "no labour", "labour on". */
/**
 * @param {string[]} tokens
 * @param {boolean[]} used
 * @param {(from: number, to: number) => void} take
 * @param {(start: number) => (NumGroup|undefined)} groupAt
 * @param {(end: number) => (NumGroup|undefined)} groupEndingAt
 * @param {(k: number) => boolean} clauseStart
 * @param {WholeBill} bill
 */
function takeLabour(tokens, used, take, groupAt, groupEndingAt, clauseStart, bill) {
    for (let i = 0; i < tokens.length; i++) {
        if (used[i] || !LABOUR.has(tokens[i])) continue;
        let k = i + 1;
        while (k < tokens.length && LABOUR_FILLER.has(tokens[k])) k++;
        let from = i;
        let to = k;
        /** @type {?VoiceLabour} */
        let labour = null;
        const g = groupAt(k);
        if (g) {
            to = g.end;
            while (to < tokens.length && PRICE_AFTER.has(tokens[to]) && !POSSESSIVE.has(tokens[to])) to++;
            const perBag = (PER_WORDS.has(tokens[to]) && BAG.has(tokens[to + 1])) || (POSSESSIVE.has(tokens[to + 1]) && BAG.has(tokens[to]))
                || (POSSESSIVE.has(tokens[to]) && BAG.has(tokens[to + 1]));
            if (perBag) to += 2;
            else if (BAG.has(tokens[to])) to += 1;
            labour = g.value === 0 ? { on: false, amount: null, perBag: null }
                : { on: true, amount: perBag ? null : g.value, perBag: perBag ? g.value : null };
        } else if (OFF.has(tokens[k]) || OFF.has(tokens[i - 1])) {
            if (OFF.has(tokens[i - 1]) && !OFF.has(tokens[k])) from = i - 1;
            else to = k + 1;
            while (to < tokens.length && (OFF.has(tokens[to]) || ON.has(tokens[to]) || words(['karo', 'करो', 'do', 'दो']).has(tokens[to]))) to++;
            labour = { on: false, amount: null, perBag: null };
        } else if (ON.has(tokens[k])) {
            to = k + 1;
            labour = { on: true, amount: null, perBag: null };
        } else {
            const before = groupEndingAt(i);
            if (before && clauseStart(before.start)) {
                from = before.start;
                labour = before.value === 0 ? { on: false, amount: null, perBag: null } : { on: true, amount: before.value, perBag: null };
            }
        }
        take(from, to);
        if (labour) bill.labour = labour;
        else bill.unclear.push(tokens.slice(from, to).join(' '));
    }
}

/** "cash 500", "500 cash", "online 300", "udhaar 200", "baaki udhaar", "pura cash". */
/**
 * @param {string[]} tokens
 * @param {boolean[]} used
 * @param {(from: number, to: number) => void} take
 * @param {(start: number) => (NumGroup|undefined)} groupAt
 * @param {(end: number) => (NumGroup|undefined)} groupEndingAt
 * @param {(k: number) => boolean} clauseStart
 * @param {WholeBill} bill
 */
function takePayments(tokens, used, take, groupAt, groupEndingAt, clauseStart, bill) {
    for (let i = 0; i < tokens.length; i++) {
        if (used[i]) continue;
        const w = tokens[i];
        /** @type {?('cash'|'online'|'due')} */
        const type = CASH.has(w) ? 'cash' : ONLINE.has(w) ? 'online' : DUE.has(w) ? 'due' : null;
        if (!type) continue;
        let from = i;
        let to = i + 1;
        const near = (/** @type {Set<string>} */ set) => {
            if (set.has(tokens[i - 1]) && !used[i - 1]) { from = i - 1; return true; }
            if (set.has(tokens[i + 1]) && !used[i + 1]) { to = i + 2; return true; }
            return false;
        };
        const rest = near(REST);
        const full = !rest && near(FULL);
        let k = to;
        while (k < tokens.length && PAY_FILLER.has(tokens[k])) k++;
        let amount = null;
        const after = groupAt(k);
        if (after && !rest && !full) {
            amount = after.value;
            to = after.end;
            while (to < tokens.length && PRICE_AFTER.has(tokens[to]) && !POSSESSIVE.has(tokens[to])) to++;
        } else if (!rest && !full) {
            let e = i;
            while (e > 0 && (PRICE_AFTER.has(tokens[e - 1]) || PAY_FILLER.has(tokens[e - 1])) && !used[e - 1]) e--;
            const before = groupEndingAt(e);
            if (before && clauseStart(before.start)) {
                amount = before.value;
                from = before.start;
            }
        }
        take(from, to);
        const pay = bill.payment;
        if (amount !== null) pay[type] = amount;
        else if (rest) pay.rest = type;
        else if (full) pay.full = type;
        else if (type === 'due') pay.rest = 'due';
        else pay.full = type;
    }
}

/** "supplier Ramesh", "from Ramesh", "customer Ramesh", "Ramesh se", "Ramesh ko", "Ramesh ke liye". */
/**
 * @param {string[]} tokens
 * @param {boolean[]} used
 * @param {(from: number, to: number) => void} take
 * @param {Array<{index: number, start: number, end: number}>} spans
 * @param {WholeBill} bill
 */
function takeParty(tokens, used, take, spans, bill) {
    const itemAt = new Set(spans.flatMap(s => Array.from({ length: s.end - s.start }, (_, n) => s.start + n)));
    const nameWord = (/** @type {number} */ k) => {
        const w = tokens[k];
        return k >= 0 && k < tokens.length && !used[k] && w !== BREAK && !itemAt.has(k) && !/\d/.test(w) && !isNumberWord(w)
            && !NOT_ITEM_WORDS.has(w) && !KEYWORDS.has(w) && !LINE_SEPARATORS.has(w) && !NAME_END.has(w) && !PARTY_AFTER.has(w)
            && w !== '₹' && w !== '@';
    };
    for (let i = 0; i < tokens.length && !bill.party; i++) {
        if (used[i] || !PARTY_BEFORE.has(tokens[i])) continue;
        let k = i + 1;
        while (k < tokens.length && NAME_FILLER.has(tokens[k]) && !used[k]) k++;
        let end = k;
        while (end < tokens.length && end - k < NAME_MAX_WORDS && nameWord(end)) end++;
        if (end === k) continue;
        const name = tokens.slice(k, end);
        while (end < tokens.length && NAME_END.has(tokens[end]) && !used[end]) end++;
        take(i, end);
        bill.party = { spoken: voiceNameCase(name), role: SUPPLIER_WORDS.has(tokens[i]) ? 'supplier' : (CUSTOMER_WORDS.has(tokens[i]) ? 'customer' : null) };
    }
    for (let i = 0; i < tokens.length && !bill.party; i++) {
        const role = PARTY_AFTER.get(tokens[i]);
        if (used[i] || !role) continue;
        let start = i;
        while (start > 0 && i - start < NAME_MAX_WORDS && nameWord(start - 1)) start--;
        if (start === i) continue;
        let to = i + 1;
        // "Ramesh ke liye", "Ramesh ko … diya"
        if ((tokens[i] === 'ke' || tokens[i] === 'के') && (tokens[to] === 'liye' || tokens[to] === 'लिए')) to++;
        take(start, to);
        bill.party = { spoken: voiceNameCase(tokens.slice(start, i)), role };
    }
    if (!bill.party) {
        for (let i = 0; i + 1 < tokens.length; i++) {
            if (!used[i] && (tokens[i] === 'ke' || tokens[i] === 'के') && (tokens[i + 1] === 'liye' || tokens[i + 1] === 'लिए')) {
                let start = i;
                while (start > 0 && i - start < NAME_MAX_WORDS && nameWord(start - 1)) start--;
                if (start === i) continue;
                take(start, i + 2);
                bill.party = { spoken: voiceNameCase(tokens.slice(start, i)), role: 'customer' };
                break;
            }
        }
    }
}

/** True when the utterance gives anything to put on the page. */
export function hasWholeBillValues(/** @type {?WholeBill|undefined} */ b) {
    if (!b) return false;
    const p = b.payment || {};
    return !!b.party || b.lines.some(hasVoiceValues) || b.rate !== null || p.cash !== null || p.online !== null || p.due !== null
        || !!p.rest || !!p.full || !!b.labour || !!b.note || !!b.date;
}

/** How much an utterance gives: picks among the recogniser's alternatives. */
function score(/** @type {WholeBill} */ b) {
    const p = b.payment;
    return 10 * b.lines.filter(l => l.itemIndex !== null && l.weight !== null).length + 2 * b.lines.filter(hasVoiceValues).length
        + (b.party ? 3 : 0) + [p.cash, p.online, p.due].filter(v => v !== null).length * 3 + (p.rest || p.full ? 3 : 0)
        + (b.labour ? 3 : 0) + (b.note ? 1 : 0) + (b.date ? 1 : 0) + (b.rate !== null ? 1 : 0) - b.unclear.length;
}

/**
 * The best of the recogniser's alternatives (the first on a tie).
 * @param {string[]} alternatives
 * @param {Array<Rec>} items
 * @param {{knownNames?: string[]}} [opts]
 * @returns {WholeBill}
 */
export function pickWholeBill(alternatives, items = [], opts = {}) {
    const parsed = (alternatives || []).filter(a => String(a || '').trim()).map(a => parseWholeBill(a, items, opts));
    let best = parsed[0];
    for (const b of parsed) if (score(b) > score(best)) best = b;
    return best || parseWholeBill('', items, opts);
}

/**
 * The check sheet's running bill: each hold adds to it (#498). A later party, payment leg,
 * labour or date replaces the earlier one; lines are added; a lone "rate 26" goes to the
 * last line heard (else it stays for the line in the form); notes are joined.
 * @param {?(WholeBill & {heardAll?: string[]})} acc
 * @param {WholeBill} next
 * @returns {WholeBill & {heardAll: string[]}}
 */
export function mergeWholeBill(acc, next) {
    const base = acc ? {
        ...acc, lines: acc.lines.slice(), payment: { ...acc.payment }, unclear: acc.unclear.slice(), heardAll: (acc.heardAll || [acc.heard]).slice()
    } : {
        heard: '', party: null, lines: [], rate: null, payment: { cash: null, online: null, due: null, rest: null, full: null },
        labour: null, note: null, date: null, unclear: [], heardAll: []
    };
    if (next.heard) base.heardAll.push(next.heard);
    base.heard = base.heardAll.join(' · ');
    if (next.party) base.party = next.party;
    base.lines.push(...next.lines);
    if (next.rate !== null) {
        const last = base.lines[base.lines.length - 1];
        if (last) base.lines[base.lines.length - 1] = { ...last, rate: next.rate, rateUnusual: false, extraNumbers: false };
        else base.rate = next.rate;
    }
    const p = next.payment;
    for (const leg of /** @type {Array<'cash'|'online'|'due'>} */ (['cash', 'online', 'due'])) {
        if (p[leg] !== null) base.payment[leg] = p[leg];
    }
    if (p.rest) {
        base.payment.rest = p.rest;
        base.payment.full = null;
    }
    if (p.full) {
        base.payment = { cash: null, online: null, due: null, rest: null, full: p.full };
    }
    if (next.labour) base.labour = next.labour;
    if (next.note) base.note = base.note ? `${base.note} ${next.note}` : next.note;
    if (next.date) base.date = next.date;
    base.unclear.push(...next.unclear);
    return base;
}

/**
 * A heard line's amount (BF-LINE), or null while its item, kg or rate is missing.
 * @param {{itemIndex: ?number, weight: ?number, rate: ?number, weights?: number[]}} line
 * @returns {?number}
 */
export function voiceLineAmount(line) {
    if (line.itemIndex === null || line.weight === null || line.rate === null) return null;
    const weights = Array.isArray(line.weights) && line.weights.length ? line.weights : [line.weight];
    return computeLine({ rate: line.rate, weights }).total;
}

/**
 * The sheet's "Lines heard" figure: the amounts of the lines that are complete.
 * @param {Array<Parameters<typeof voiceLineAmount>[0]>} lines
 * @returns {number}
 */
export function voiceLinesTotal(lines) {
    return sumMoney(lines.map(voiceLineAmount).filter(a => a !== null));
}

/**
 * "labour 6 per bag": the Labour box for the bill's heavy bags, rounded as the auto labour is (BF-LAB).
 * @param {?number} perBag
 * @param {number} heavyPackets
 * @returns {number}
 */
export function labourForBags(perBag, heavyPackets) {
    if (!(Number(perBag) > 0)) return 0;
    return autoLabour({ laborRate: perBag }, heavyPackets).box;
}
