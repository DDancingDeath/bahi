/**
 * @fileoverview Voice billing (#81, #131, #498). Hold the mic and speak (a quick tap listens
 * once); what was heard is sorted into the parts of the Billing page (utils/voice-bill-parse.js):
 * the party, bill lines, bag weights, a rate, the payment, labour, a note and the day. A check
 * sheet shows it all (and reads it back); each further hold adds to it; only "Fill bill" puts
 * it on the page, as typing would. It never saves; nothing heard is stored. The small mic in
 * the name field (#498) matches a spoken name to known parties and offers the closest ones.
 * Loaded with import() on the first mic use (ui/voice-mic.js). Design: docs/voice-billing.md.
 * @module modules/voice-billing
 */

import { AppState } from '../utils/state.js';
import { UIManager } from '../ui/ui-manager.js';
import { Helpers } from '../utils/helpers.js';
import { t, getLang } from '../i18n/index.js';
import { isUndoCommand, voiceTokens, VOICE_WORDS, voiceNameCase } from '../utils/voice-parse.js';
import { pickWholeBill, hasWholeBillValues, mergeWholeBill, voiceLineAmount, voiceLinesTotal, labourForBags } from '../utils/voice-bill-parse.js';
import { createVoiceUndo, planUndo, fieldChanges } from '../utils/voice-undo.js';
import { entriesFromNames, rankPartyMatches } from '../utils/party-match.js';
import { partyEntriesFor, fillPartyName, dueText } from '../ui/party-suggest.js';
import { computeRetailTotals, restInDue } from '../utils/calc/billing.js';
import { billDayRange } from '../utils/bill-date.js';
import { billDateWho, canChangeBillDate, renderBillDateLine } from '../ui/bill-date-input.js';
import { addLocalDays, formatDate, toLocalISODate } from '../utils/dates.js';
import { formatRupees } from '../utils/money.js';
import { contactPickerKind } from '../utils/contact-picker.js';
import { isArchivedItem } from '../utils/item-catalog.js';
import { safeSetItem } from '../utils/storage-full.js';
import { track, trackVoiceMiss } from '../services/usage.js';
import { on, BILL_CLEARED } from '../utils/events.js';
import { VoiceMic } from '../ui/voice-mic.js';
import { BillingManager, PurchaseManager, RetailSaleManager, syncBillNotes } from './billing.js';

const FIELDS = {
    purchase: {
        key: 'purchase', kind: 'purchase',
        mic: 'voiceMicPurchase', nameMic: 'voiceNamePurchase', item: 'billItem', rate: 'billRate', weight: 'newWeight',
        customer: 'customerName', customerNames: 'customerOptions',
        transcript: 'voiceTranscriptPurchase', undo: 'voiceUndoPurchase', lock: 'purchase',
        cash: 'cashPayment', online: 'onlinePayment', due: 'dueAmount', note: 'billComments', date: 'billDate',
        labourOn: 'autoLaborCharge', labour: 'manualLaborCharges',
        editing: () => !!PurchaseManager.isEditingLine?.(),
        pending: () => PurchaseManager.getWeights() || [],
        loadRates: () => BillingManager.loadRates(),
        addLine: () => PurchaseManager.addToBill(),
        addWeights: (list) => PurchaseManager.addWeights(list),
        lines: () => PurchaseManager.getBillItems() || [],
        removeLine: (i) => PurchaseManager.deleteBillItem(i),
        lineCount: () => (PurchaseManager.getBillItems() || []).length,
        total: () => PurchaseManager.computeTotals().grandTotal,
        split: () => PurchaseManager.readPaymentSplit(),
        payChanged: () => PurchaseManager.updatePaymentTotal(),
        restToDue: () => PurchaseManager.putRestInDue(),
        fillAll: (type) => PurchaseManager.fillPayableAmount(type),
        heavyPackets: () => PurchaseManager.computeTotals(0).heavyPackets,
        totalsChanged: () => PurchaseManager.updateTotals()
    },
    sale: {
        key: 'sale', kind: 'retail',
        mic: 'voiceMicSale', nameMic: 'voiceNameSale', item: 'saleItem', rate: 'saleRate', weight: 'saleWeight',
        customer: 'saleCustomerName', customerNames: 'saleCustomerOptions',
        transcript: 'voiceTranscriptSale', undo: 'voiceUndoSale', lock: 'retail',
        cash: 'saleCashPayment', online: 'saleOnlinePayment', due: 'saleDueAmount', note: 'saleComments', date: 'saleDate',
        labourOn: null, labour: null,
        editing: () => !!RetailSaleManager.isEditingLine?.(),
        pending: () => RetailSaleManager.getSaleWeights() || [],
        loadRates: () => BillingManager.loadSaleRates(),
        addLine: () => RetailSaleManager.addToSalesBill(),
        addWeights: (list) => {
            RetailSaleManager.setSaleWeights([...(RetailSaleManager.getSaleWeights() || []), ...list]);
            RetailSaleManager.renderSaleWeights?.();
        },
        lines: () => RetailSaleManager.getSaleItems() || [],
        removeLine: (i) => RetailSaleManager.removeSaleItem(i),
        lineCount: () => (RetailSaleManager.getSaleItems() || []).length,
        total: () => computeRetailTotals(RetailSaleManager.getSaleItems() || []).total,
        split: () => RetailSaleManager.readPaymentSplit(),
        payChanged: () => RetailSaleManager.updateSalePaymentTotal(),
        restToDue: () => RetailSaleManager.putRestInDue(),
        fillAll: (type) => RetailSaleManager.fillReceivableAmount(type),
        heavyPackets: () => 0,
        totalsChanged: () => RetailSaleManager.updateSaleTotals?.()
    }
};

export const READBACK_KEY = 'aadhat.voiceReadback';

/**
 * Spoken readback (#81 A1) with the browser's speechSynthesis, only through a voice on
 * this device (`localService`): a network voice (Chrome's "Google …" voices) would send
 * the text to a server. None for the language (the Android WebView often has no
 * speechSynthesis or no voices): nothing is said and the switch is hidden.
 * @param {string} lang 'hi-IN' or 'en-IN'
 * @param {any} [win]
 * @returns {?SpeechSynthesisVoice}
 */
export function localVoice(lang, win = window) {
    try {
        const synth = win.speechSynthesis;
        if (typeof synth?.speak !== 'function' || typeof win.SpeechSynthesisUtterance !== 'function') return null;
        const want = String(lang || '').toLowerCase();
        const tag = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
        const voices = (synth.getVoices?.() || []).filter(v => v && v.localService === true);
        return voices.find(v => tag(v) === want) || voices.find(v => tag(v).split('-')[0] === want.split('-')[0]) || null;
    } catch {
        return null;
    }
}

export const Readback = {
    /** On unless muted on this device. */
    isOn() {
        try { return localStorage.getItem(READBACK_KEY) !== '0'; } catch { return true; }
    },

    setOn(on) {
        safeSetItem(READBACK_KEY, on ? '1' : '0');
        if (!on) this.stop();
    },

    /** @returns {boolean} true when it was handed to an on-device voice */
    speak(text, lang, win = window) {
        if (!text || !this.isOn()) return false;
        const voice = localVoice(lang, win);
        if (!voice) return false;
        try {
            const synth = win.speechSynthesis;
            synth.cancel();
            const u = new win.SpeechSynthesisUtterance(text);
            u.lang = lang;
            u.voice = voice;
            synth.speak(u);
            return true;
        } catch {
            return false;
        }
    },

    stop(win = window) {
        try { win.speechSynthesis?.cancel?.(); } catch { /* nothing to stop */ }
    }
};

let audio = null;

/**
 * A short tone after listening (#131), when switched on in Settings: high when something was
 * understood, low when not. Web Audio on this device; nothing is recorded or sent.
 * @param {'ok'|'fail'} kind
 * @returns {boolean} true when a tone was played
 */
export function beep(kind, win = window) {
    if (!VoiceMic.beepOn()) return false;
    try {
        const Ctx = win.AudioContext || win.webkitAudioContext;
        if (typeof Ctx !== 'function') return false;
        audio = audio || new Ctx();
        audio.resume?.()?.catch?.(() => {});
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = kind === 'ok' ? 880 : 220;
        gain.gain.value = 0.08;
        osc.connect(gain);
        gain.connect(audio.destination);
        const start = audio.currentTime || 0;
        osc.start(start);
        osc.stop(start + (kind === 'ok' ? 0.12 : 0.3));
        return true;
    } catch {
        return false;
    }
}

const LISTEN_TIMEOUT_MS = 15000;
/** A hold listens at most this long. */
const HOLD_MAX_MS = 60000;
/** After a quick tap, the browser engine stops this long after the last words. */
const QUIET_MS = 1500;
/** After release, how long the engine may take to give its last words. */
const FINAL_WAIT_MS = 2500;

/** Error codes of both engines → message key ('' = say nothing, the user stopped it). */
export function voiceErrorKey(code) {
    const c = String(code || '').toLowerCase();
    if (c === 'aborted') return '';
    if (c === 'no-recogniser') return 'msg.voice.no_recogniser';
    if (c.includes('no-speech') || c.includes('no speech') || c.includes('no match')) return 'msg.voice.no_speech';
    if (c.includes('not-allowed') || c.includes('permission') || c.includes('audio-capture')) return 'msg.voice.mic_denied';
    if (c.includes('network')) return 'msg.voice.offline';
    if (c.includes('busy')) return 'msg.voice.busy';
    if (c.includes('unavailable') || c.includes('not available')) return 'msg.voice.unavailable';
    return 'msg.voice.failed';
}

let micGranted = false;

/** Forget that the microphone was allowed (tests; Android restarts the app when it is taken back). */
export function forgetMicPermission() {
    micGranted = false;
}

/**
 * The Android app's microphone permission (#498): checked on each first use, asked for only
 * when Android may still ask. 'asked' = just allowed in the system dialog.
 * @param {any} plugin Capacitor SpeechRecognition
 * @returns {Promise<'granted'|'asked'|'denied'>}
 */
export async function micPermission(plugin) {
    if (micGranted) return 'granted';
    let perm = (await plugin.checkPermissions?.())?.speechRecognition;
    if (perm === 'granted') {
        micGranted = true;
        return 'granted';
    }
    perm = (await plugin.requestPermissions?.())?.speechRecognition;
    if (perm === 'granted') {
        micGranted = true;
        return 'asked';
    }
    return 'denied';
}

/** The phone's recogniser is there (Google's speech services or another). */
async function nativeReady(plugin) {
    if (!plugin) throw new Error('unavailable');
    const { available } = await plugin.available();
    if (!available) throw new Error('no-recogniser');
}

/** Browser Web Speech API (Chrome): one utterance, up to 3 alternatives. */
export function listenWeb(lang, win = window) {
    return new Promise((resolve, reject) => {
        const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
        if (!Ctor) { reject(new Error('unavailable')); return; }
        const rec = new Ctor();
        rec.lang = lang;
        rec.continuous = false;
        rec.interimResults = false;
        rec.maxAlternatives = 3;
        const heard = [];
        let done = false;
        let timer = null;
        const finish = (fn, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            fn(value);
        };
        timer = setTimeout(() => {
            try { rec.abort(); } catch { /* already stopped */ }
            finish(resolve, heard);
        }, LISTEN_TIMEOUT_MS);
        rec.onresult = (e) => {
            for (let i = e.resultIndex || 0; i < e.results.length; i++) {
                for (let k = 0; k < e.results[i].length; k++) heard.push(e.results[i][k].transcript);
            }
        };
        rec.onerror = (e) => finish(reject, new Error(e?.error || 'failed'));
        rec.onend = () => finish(resolve, heard);
        try { rec.start(); } catch (e) { finish(reject, e); }
    });
}

/** Android app: the phone's own recogniser through @capacitor-community/speech-recognition, one utterance. */
export async function listenNative(lang, plugin) {
    await nativeReady(plugin);
    if ((await micPermission(plugin)) === 'denied') throw new Error('not-allowed');
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            // The plugin's stop() never answers: never wait for it
            Promise.resolve(plugin.stop?.()).catch(() => {});
            reject(new Error('no-speech'));
        }, LISTEN_TIMEOUT_MS);
    });
    try {
        const res = await Promise.race([plugin.start({ language: lang, maxResults: 3, partialResults: false, popup: false }), timeout]);
        return res?.matches || [];
    } finally {
        clearTimeout(timer);
    }
}

/** The recogniser's alternatives for the words heard so far: earlier pieces' best, then each guess for the last. */
function joinPieces(/** @type {string[][]} */ pieces) {
    const list = pieces.filter(p => p.length);
    if (!list.length) return [];
    const head = list.slice(0, -1).map(p => p[0]).join(' ');
    return list[list.length - 1].map(a => `${head} ${a}`.trim()).filter(Boolean);
}

/**
 * Hold-to-talk (#498): listens until stop(), across the pauses at which an engine ends by itself
 * (it starts again while the mic is held), with the words so far through onPartial.
 * finishOnSilence() turns it into a one-shot listen (a quick tap); abort() drops what was heard.
 * @param {'native'|'web'} engine
 * @param {string} lang
 * @param {{onPartial?: (text: string) => void, win?: any}} [opts]
 * @returns {{result: Promise<string[]>, stop: () => void, finishOnSilence: () => void, abort: () => void}}
 */
export function openSession(engine, lang, { onPartial = () => {}, win = window } = {}) {
    let held = true;
    let stopping = false;
    let aborted = false;
    let done = false;
    let restarts = 0;
    /** @type {string[][]} */
    const pieces = [];
    /** @type {string[]} */
    let current = [];
    let resolveFn = (_) => {};
    let rejectFn = (_) => {};
    const result = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
    const timers = new Set();
    const later = (fn, ms) => {
        const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
        timers.add(id);
        return id;
    };
    const cleanups = [];
    const heard = () => joinPieces([...pieces, current]);
    const tellPartial = () => { try { onPartial(heard()[0] || ''); } catch { /* display only */ } };
    const finish = (err = null) => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        timers.clear();
        cleanups.forEach(fn => { try { fn(); } catch { /* already gone */ } });
        const words = aborted ? [] : heard();
        if (err && !words.length && !aborted) rejectFn(err);
        else resolveFn(words);
    };
    later(() => api.stop(), HOLD_MAX_MS);

    /** @type {{stop: () => void, abort: () => void, quiet: () => void}} */
    let engineApi;
    if (engine === 'native') {
        const plugin = win.Capacitor?.Plugins?.SpeechRecognition;
        let ended = false;
        let restarting = false;
        const begin = () => plugin.start({ language: lang, maxResults: 3, partialResults: true, popup: false });
        // Android ended (a pause, or after stop): its last words come just after
        const onEnded = () => {
            if (done || ended || restarting) return;
            ended = true;
            if (stopping) return;
            later(() => {
                if (done) return;
                if (current.length) pieces.push(current);
                current = [];
                if (held && !aborted && restarts < 20) {
                    restarts++;
                    restarting = true;
                    Promise.resolve(begin()).then(() => { ended = false; restarting = false; })
                        .catch(e => { restarting = false; finish(e); });
                    return;
                }
                finish(new Error('no-speech'));
            }, 400);
        };
        const listen = (event, fn) => Promise.resolve(plugin.addListener?.(event, fn))
            .then(h => { if (done) h?.remove?.(); else cleanups.push(() => h?.remove?.()); });
        (async () => {
            try {
                await listen('partialResults', (d) => {
                    const matches = (d?.matches || []).map(String).filter(m => m.trim());
                    if (!matches.length || done) return;
                    current = matches.slice(0, 3);
                    tellPartial();
                    // After stop(), the next result is the last one
                    if (stopping) later(() => finish(), 150);
                });
                await listen('listeningState', (d) => { if (d?.status === 'stopped') onEnded(); });
                await begin();
                const poll = setInterval(async () => {
                    if (done || restarting || ended) return;
                    try {
                        const state = await plugin.isListening?.();
                        if (state && state.listening === false) onEnded();
                    } catch { /* keep listening */ }
                }, 1000);
                cleanups.push(() => clearInterval(poll));
                if (aborted || stopping) engineApi[aborted ? 'abort' : 'stop']();
            } catch (e) {
                finish(e);
            }
        })();
        engineApi = {
            stop: () => {
                // The plugin's stop() never answers: never wait for it
                Promise.resolve(plugin.stop?.()).catch(() => {});
                later(() => finish(), ended ? 500 : FINAL_WAIT_MS);
            },
            abort: () => {
                Promise.resolve(plugin.stop?.()).catch(() => {});
                finish();
            },
            quiet: () => { if (ended) later(() => finish(), 400); }
        };
    } else {
        const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
        /** @type {any} */
        let rec = null;
        let lastError = null;
        let quietTimer = null;
        const armQuiet = () => {
            if (held || stopping) return;
            clearTimeout(quietTimer);
            timers.delete(quietTimer);
            quietTimer = later(() => engineApi.stop(), QUIET_MS);
        };
        const begin = () => {
            rec = new Ctor();
            rec.lang = lang;
            rec.continuous = true;
            rec.interimResults = true;
            rec.maxAlternatives = 3;
            rec.onresult = (e) => {
                /** @type {string[][]} */
                const finals = [];
                let interim = [];
                for (let i = 0; i < e.results.length; i++) {
                    const r = e.results[i];
                    const alts = [];
                    for (let k = 0; k < r.length; k++) alts.push(String(r[k].transcript || ''));
                    if (r.isFinal) finals.push(alts);
                    else interim = alts;
                }
                current = joinPieces([...finals, interim]);
                tellPartial();
                armQuiet();
            };
            rec.onerror = (e) => {
                const code = e?.error || 'failed';
                if (code === 'no-speech' && held) return;
                if (code !== 'aborted') lastError = new Error(code);
            };
            rec.onend = () => {
                if (current.length) pieces.push(current);
                current = [];
                if (held && !stopping && !aborted && !lastError && restarts < 20) {
                    restarts++;
                    try { begin(); return; } catch (e) { lastError = e; }
                }
                finish(lastError || new Error('no-speech'));
            };
            rec.start();
        };
        if (!Ctor) later(() => finish(new Error('unavailable')), 0);
        else {
            try { begin(); } catch (e) { later(() => finish(e), 0); }
        }
        engineApi = {
            stop: () => {
                stopping = true;
                try { rec?.stop(); } catch { /* already stopped */ }
                later(() => finish(), FINAL_WAIT_MS);
            },
            abort: () => {
                try { rec?.abort(); } catch { /* already stopped */ }
                finish();
            },
            quiet: () => {
                if (current.length) armQuiet();
                else later(() => engineApi.stop(), LISTEN_TIMEOUT_MS);
            }
        };
    }
    const api = {
        result,
        stop() {
            if (done || stopping) return;
            held = false;
            stopping = true;
            engineApi.stop();
        },
        finishOnSilence() {
            if (done) return;
            held = false;
            engineApi.quiet();
        },
        abort() {
            if (done) return;
            held = false;
            aborted = true;
            engineApi.abort();
        }
    };
    return api;
}

const byId = (id) => document.getElementById(id);
const esc = (s) => Helpers.escapeHtml(String(s ?? ''));
const itemLabel = (item) => (AppState.settings?.showHindi && item.hindiName ? item.hindiName : item.name) || '';
/** Readback names the item in the language it is spoken in. */
const spokenLabel = (item) => (getLang() === 'hi' && item.hindiName ? item.hindiName : item.name) || '';
/** Column heads reuse the form labels without their colon. */
const head = (key) => t(key).replace(/\s*[:：]\s*$/, '');
/** The line's item as it was when heard (the item list can change while the sheet is open). */
const lineItem = (line) => (line.item !== undefined ? line.item : (line.itemIndex !== null ? AppState.items[line.itemIndex] : null));
const complete = (line) => line.itemIndex !== null && line.weight !== null && line.rate !== null;
const formKey = (mode) => (mode === 'sale' ? 'sale' : 'purchase');
const value = (id) => String((id && byId(id)?.value) ?? '');
const boxes = (f) => ({
    customer: value(f.customer), item: value(f.item), rate: value(f.rate), weight: value(f.weight),
    cash: value(f.cash), online: value(f.online), due: value(f.due), note: value(f.note),
    ...(f.labour ? {
        labour: value(f.labour), labourOn: byId(f.labourOn)?.checked === false ? '0' : '1',
        labourTyped: byId(f.labour)?.dataset.manuallySet ? '1' : '0'
    } : {})
});
/** A typed correction: a positive number, else not heard. */
const typedNumber = (v) => {
    const text = String(v ?? '').trim();
    const n = Number(text.replace(',', '.'));
    return text !== '' && Number.isFinite(n) && n > 0 ? n : null;
};
/** A typed amount: 0 or more, else none. */
const typedAmount = (v) => {
    const text = String(v ?? '').trim();
    const n = Number(text.replace(',', '.'));
    return text !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};
const lineAmount = (line) => voiceLineAmount(line);
const hasExtras = (b) => !!b && (b.rate !== null || b.labour || b.note || b.date || b.unclear.length > 0
    || ['cash', 'online', 'due', 'rest', 'full'].some(k => b.payment[k] !== null && b.payment[k] !== undefined)
    || b.lines.some(l => Array.isArray(l.weights) && l.weights.length > 0));
/** A payment leg's Fill box (onlineCheckbox, saleCashCheckbox…). */
const payBox = (f, k) => byId(f.key === 'sale' ? `sale${k[0].toUpperCase()}${k.slice(1)}Checkbox` : `${k}Checkbox`);
const PAY_LABEL = { cash: 'ui.billing.cash_label', online: 'ui.billing.online_label', due: 'ui.billing.due_label' };
const HONORIFIC_END = new Set(['ji', 'जी']);
const NAME_DROP = new Set([...VOICE_WORDS.CUSTOMER_WORDS, ...VOICE_WORDS.NAME_FILLER, ...VOICE_WORDS.NAME_END,
    'from', 'supplier', 'seller', 'farmer', 'mr', 'mrs', 'shri', 'please', 'सप्लायर', 'श्री']);

/** The name in what was said for the name mic: "Ramesh bhai se" → "Ramesh Bhai", "customer Suresh" → "Suresh". */
export function nameFromSpeech(text) {
    const words = voiceTokens(text).filter(w => !/\d/.test(w));
    let a = 0;
    let b = words.length;
    while (a < b && NAME_DROP.has(words[a])) a++;
    while (b > a && NAME_DROP.has(words[b - 1]) && !HONORIFIC_END.has(words[b - 1])) b--;
    return voiceNameCase(words.slice(a, Math.min(b, a + 4)));
}

export const VoiceBilling = {
    busy: false,
    /** A listen (tap or hold) is running. */
    listening: false,
    /** @type {?{text: string, lang: string}} what the open check sheet reads aloud */
    spoken: null,
    /** Voice changes per form, last first (#131). */
    undo: { purchase: createVoiceUndo(), sale: createVoiceUndo() },
    /** @type {?{lines: Array, items: Array}} the open check sheet's lines and the item list it offers */
    checking: null,
    /** @type {?{key: string, acc: any, history: any[], partyChoice: ?string}} the open check sheet (#498) */
    sheet: null,
    /** What the current action heard, for the transcript strip. */
    heardNow: '',

    /**
     * A tap or a key on the mic: listen once, then the check sheet (or add to the open one).
     * @param {'purchase'|'sale'} mode
     * @param {'native'|'web'} engine
     * @returns {Promise<boolean>} true when something was put on the page
     */
    async listenOnce(mode, engine) {
        const key = formKey(mode);
        const f = FIELDS[key];
        if (this.listening || this.busy) return false;
        this.listening = true;
        this.heardNow = '';
        const mic = this.micFor(f);
        this.showListening(f, mic, true, t('msg.voice.listening'));
        let heard;
        try {
            // Chrome loads its voice list on first ask; by the time speech is heard it is there
            try { window.speechSynthesis?.getVoices?.(); } catch { /* no speech synthesis */ }
            heard = engine === 'native'
                ? await listenNative(this.lang(), window.Capacitor?.Plugins?.SpeechRecognition)
                : await listenWeb(this.lang());
        } catch (e) {
            this.listenFailed(f, e);
            return false;
        } finally {
            this.listening = false;
            this.showListening(f, mic, false);
        }
        return this.handleHeard(key, heard);
    },

    /**
     * The mic pressed and held (#498): listens until released. Released quickly, it listens once
     * (to the first pause); released off the button, or the press cancelled, nothing is used.
     * In the Android app the first press asks for the microphone and does not listen yet.
     * @param {'purchase'|'sale'} mode
     * @param {'native'|'web'} engine
     * @param {{btn?: ?HTMLElement, released?: boolean, cancel?: boolean, quick?: boolean, session?: any}} hold
     * @returns {Promise<boolean>}
     */
    async beginHold(mode, engine, hold) {
        const key = formKey(mode);
        const f = FIELDS[key];
        if (this.listening || this.busy) return false;
        this.listening = true;
        this.heardNow = '';
        const mic = hold.btn || this.micFor(f);
        let heard;
        try {
            if (engine === 'native') {
                const plugin = window.Capacitor?.Plugins?.SpeechRecognition;
                await nativeReady(plugin);
                const perm = await micPermission(plugin);
                if (perm !== 'granted') {
                    // The system dialog took the press: listen from the next one
                    const msg = t(perm === 'asked' ? 'msg.voice.mic_allowed' : 'msg.voice.mic_denied');
                    this.setStrip(f, '', msg);
                    UIManager.showToast(msg, 5000);
                    return false;
                }
            }
            if (hold.released && hold.cancel) return false;
            try { window.speechSynthesis?.getVoices?.(); } catch { /* no speech synthesis */ }
            this.showListening(f, mic, true, t('msg.voice.hold_listening'));
            const session = openSession(engine, this.lang(), { onPartial: (text) => this.showLive(f, text) });
            hold.session = session;
            if (hold.released) this.endHold(hold);
            heard = await session.result;
        } catch (e) {
            this.listenFailed(f, e);
            return false;
        } finally {
            this.listening = false;
            this.showListening(f, mic, false);
        }
        if (hold.cancel) {
            this.showLive(f, '');
            this.setStrip(f, '', t('ui.voice.strip_hold_cancelled'));
            return false;
        }
        return this.handleHeard(key, heard);
    },

    /** The press ended: stop (held), listen to the first pause (quick tap) or drop it (slid off / cancelled). */
    endHold(hold) {
        const s = hold?.session;
        if (!s) return;
        if (hold.cancel) s.abort();
        else if (hold.quick) s.finishOnSilence();
        else s.stop();
    },

    lang() {
        return getLang() === 'hi' ? 'hi-IN' : 'en-IN';
    },

    micFor(f) {
        return this.sheet ? (document.querySelector('#modalMessage [data-voice-hold]') || byId(f.mic)) : byId(f.mic);
    },

    showListening(f, mic, on, message = '') {
        if (mic) {
            mic.classList.toggle('voice-listening', on);
            if (on) mic.setAttribute('aria-busy', 'true');
            else mic.removeAttribute('aria-busy');
        }
        if (on) {
            UIManager.showToast(message);
            this.setStrip(f, '', message);
            this.showLive(f, '');
            return;
        }
        const toast = byId('toast');
        if (toast && [t('msg.voice.listening'), t('msg.voice.hold_listening'), t('msg.voice.name_listening')].includes(toast.textContent)) toast.classList.remove('show');
    },

    /** Words so far while the mic is held, under the mic (and in the open check sheet). */
    showLive(f, text) {
        const live = byId('voiceSheetLive');
        if (live) live.textContent = text ? t('ui.voice.live', { text }) : '';
        if (text) this.setStrip(f, '', t('ui.voice.live', { text }));
    },

    listenFailed(f, e) {
        const errKey = voiceErrorKey(e?.message || e);
        if (!errKey) return;
        beep('fail');
        this.setStrip(f, this.heardNow, t(errKey));
        UIManager.showToast(t(errKey), 5000);
    },

    knownNames(f) {
        return [...(byId(f.customerNames)?.options || [])].map(o => o.value).filter(Boolean);
    },

    /** The parties a spoken name may be, closest first, and the one it surely is (if any). */
    partyMatches(f, spoken) {
        let entries;
        try { entries = partyEntriesFor(f.kind); } catch { entries = entriesFromNames(this.knownNames(f)); }
        return rankPartyMatches(entries, spoken);
    },

    /**
     * What was heard: "undo", or parts of the bill for the check sheet (a new one, or added to the open one).
     * @param {'purchase'|'sale'} key
     * @param {string[]} heard alternatives
     * @returns {Promise<boolean>}
     */
    async handleHeard(key, heard) {
        const f = FIELDS[key];
        if (!(heard || []).some(h => String(h || '').trim())) {
            beep('fail');
            this.setStrip(f, '', t('msg.voice.no_speech'));
            UIManager.showToast(t('msg.voice.no_speech'));
            return false;
        }
        this.heardNow = String(heard.find(h => String(h || '').trim())).trim();
        if (isUndoCommand(heard)) {
            beep('ok');
            if (this.sheet?.key === key) return this.undoSheetStep();
            this.undoLast(key, true);
            return false;
        }
        const bill = pickWholeBill(heard, AppState.items, { knownNames: this.knownNames(f) });
        this.heardNow = bill.heard;
        if (!hasWholeBillValues(bill)) {
            beep('fail');
            trackVoiceMiss(bill.heard);
            const msg = t('msg.voice.not_understood', { heard: bill.heard });
            if (this.sheet?.key === key) {
                const live = byId('voiceSheetLive');
                if (live) live.textContent = msg;
                return false;
            }
            this.tell(f, msg, 4000);
            return false;
        }
        beep('ok');
        bill.lines = bill.lines.map(l => ({ ...l, item: lineItem(l) }));
        if (bill.party) bill.party = { ...bill.party, ...this.partyMatches(f, bill.party.spoken) };
        if (this.sheet?.key === key) {
            this.captureSheet();
            this.sheet.history.push(this.sheet.acc);
            this.sheet.acc = mergeWholeBill(this.sheet.acc, bill);
            if (bill.party) this.sheet.partyChoice = null;
            this.renderSheet();
            this.readAloud([bill], key);
            return true;
        }
        return this.openVoiceSheet(key, bill);
    },

    /** "undo" said while the check sheet is open: takes back what the last hold added to it. */
    undoSheetStep() {
        const sheet = this.sheet;
        if (!sheet?.history.length) {
            const live = byId('voiceSheetLive');
            if (live) live.textContent = t('msg.voice.undo_none');
            return false;
        }
        sheet.acc = sheet.history.pop();
        this.renderSheet();
        const live = byId('voiceSheetLive');
        if (live) live.textContent = t('ui.voice.sheet_undone');
        return true;
    },

    /** Opens the check sheet and, after "Fill bill", puts what it shows on the page. */
    async openVoiceSheet(key, bill) {
        const f = FIELDS[key];
        this.sheet = { key, acc: mergeWholeBill(null, bill), history: [], partyChoice: null };
        this.setStrip(f, bill.heard, t('ui.voice.strip_check', { fill: t('ui.voice.fill_bill') }));
        const asked = UIManager.showModalWithHtml(this.sheetHtml(), t('ui.voice.check_title'), true, { confirmLabel: t('ui.voice.fill_bill') });
        this.readAloud([bill], key);
        let ok = false;
        let sheet = null;
        try {
            ok = await asked;
            sheet = this.sheet;
            if (ok) this.captureSheet();
        } finally {
            this.spoken = null;
            Readback.stop();
            this.sheet = null;
        }
        if (!ok) {
            this.checking = null;
            this.setStrip(f, sheet?.acc.heard || bill.heard, t('ui.voice.strip_cancelled'));
            return false;
        }
        if (Helpers.isBusy(f.lock)) {
            this.checking = null;
            this.tell(f, t('msg.voice.finish_saving'), 4000);
            return false;
        }
        this.heardNow = sheet.acc.heard;
        this.busy = true;
        const before = boxes(f);
        const linesBefore = f.lines().slice();
        try {
            return await this.applySheet(f, sheet);
        } finally {
            this.busy = false;
            this.checking = null;
            const added = f.lines().filter(l => !linesBefore.includes(l));
            if (this.undo[key].push({ lines: added, fields: fieldChanges(before, boxes(f)) })) this.refreshUndo(key);
        }
    },

    readAloud(bills, key) {
        const lang = this.lang();
        const text = !!localVoice(lang) && bills.map(b => this.readbackText(b.party?.spoken || null, b.lines.map(l => ({ ...l, item: lineItem(l) })), b, key)).filter(Boolean).join('. ');
        this.spoken = text ? { text, lang } : null;
        if (this.spoken) Readback.speak(this.spoken.text, lang);
    },

    /** Reads what the user changed in the open sheet into it (so a new hold or Fill bill keeps it). */
    captureSheet() {
        const sheet = this.sheet;
        const root = byId('voiceCheck');
        if (!sheet || !root) return;
        const acc = sheet.acc;
        acc.lines = acc.lines.map((line, i) => {
            const now = this.correctedLine({ ...line, item: lineItem(line) }, i);
            const tick = root.querySelector(`[data-voice-line="${i}"]`);
            return { ...now, unticked: tick ? !tick.checked : !!line.unticked };
        });
        const tick = (id) => root.querySelector(`#${id}`);
        if (acc.party) {
            const pick = tick('voicePartyPick');
            if (pick) sheet.partyChoice = pick.value;
            if (tick('voiceCustomerTick') && !tick('voiceCustomerTick').checked) acc.party = { ...acc.party, skip: true };
            else if (acc.party.skip) acc.party = { ...acc.party, skip: false };
        }
        root.querySelectorAll('[data-voice-pay]').forEach(input => {
            acc.payment[input.dataset.voicePay] = typedAmount(input.value);
        });
        if (tick('voicePayRest') && !tick('voicePayRest').checked) acc.payment.rest = null;
        if (tick('voicePayFull') && !tick('voicePayFull').checked) acc.payment.full = null;
        if (acc.labour) {
            if (tick('voiceLabourTick') && !tick('voiceLabourTick').checked) acc.labour = null;
            else if (tick('voiceLabour')) {
                const v = typedAmount(tick('voiceLabour').value);
                acc.labour = acc.labour.perBag !== null ? { ...acc.labour, perBag: v } : { ...acc.labour, amount: v };
            }
        }
        if (tick('voiceNote')) acc.note = String(tick('voiceNote').value || '').trim() || null;
        if (tick('voiceDateTick') && !tick('voiceDateTick').checked) acc.date = null;
        if (tick('voiceRateTick') && !tick('voiceRateTick').checked) acc.rate = null;
        else if (tick('voiceRate')) acc.rate = typedNumber(tick('voiceRate').value);
    },

    renderSheet() {
        const el = byId('voiceCheck');
        if (el) el.outerHTML = this.sheetHtml();
        else {
            const msg = byId('modalMessage');
            if (msg) msg.innerHTML = this.sheetHtml();
        }
    },

    /** The party the sheet will fill: the one picked, the one surely meant, or the words as said. */
    partyName(party, choice) {
        if (!party || party.skip) return null;
        const matches = party.matches || [];
        const pick = choice ?? (party.sure ? `m${matches.indexOf(party.sure) === -1 ? 0 : matches.indexOf(party.sure)}` : 'spoken');
        if (pick.startsWith('m')) return matches[Number(pick.slice(1))]?.name || party.spoken;
        return party.spoken;
    },

    /** The day a spoken date stands for, and whether this bill may take it (owner, not an edited / locked bill, in range). */
    dateFor(f, date) {
        if (!date) return null;
        const now = new Date();
        const day = toLocalISODate(/** @type {Date} */ (addLocalDays(now, -date.daysAgo)));
        const input = byId(f.date);
        if (!canChangeBillDate() || !input || input.disabled || input.dataset.locked) return { day, ok: false, why: 'ui.voice.date_not_allowed' };
        const range = billDayRange(billDateWho(now));
        if (day < range.min || day > range.max) return { day, ok: false, why: 'ui.voice.date_out_of_range' };
        return { day, ok: true, why: '' };
    },

    /** The check sheet (#498): everything understood, each part editable or untickable; unclear parts marked. */
    sheetHtml() {
        const sheet = this.sheet;
        const f = FIELDS[sheet.key];
        const acc = sheet.acc;
        const lines = acc.lines.map(l => ({ ...l, item: lineItem(l) }));
        this.checking = { lines, items: AppState.items.slice() };
        const simple = lines.length === 1 && !hasExtras(acc);
        let html = `<div id="voiceCheck" class="voice-sheet"><p class="voice-heard">${esc(t('ui.voice.heard'))} `
            + `${(acc.heardAll || [acc.heard]).map(h => `<q>${esc(h)}</q>`).join(' ')}</p>`;
        html += this.partyHtml(f, acc.party, sheet.partyChoice);
        if (lines.length) html += this.linesHtml(lines, simple);
        if (acc.rate !== null) {
            html += `<p class="voice-part"><label><input type="checkbox" id="voiceRateTick" checked> ${esc(t('ui.voice.rate_current'))}</label> `
                + `<span class="adorn voice-part-input"><span class="adorn-pre" aria-hidden="true">₹</span><input class="input" type="number" inputmode="decimal" min="0" step="any" id="voiceRate" value="${esc(acc.rate)}" aria-label="${esc(t('ui.voice.rate_current'))}"></span></p>`;
        }
        html += this.labourHtml(f, acc.labour);
        html += this.paymentHtml(acc.payment);
        if (acc.note !== null) {
            html += `<p class="voice-part"><label for="voiceNote">${esc(head('ui.billing.notes_label'))}</label> `
                + `<input class="input" type="text" id="voiceNote" value="${esc(acc.note)}"></p>`;
        }
        const date = this.dateFor(f, acc.date);
        if (date?.ok) {
            html += `<p class="voice-part"><label><input type="checkbox" id="voiceDateTick" checked> ${esc(t('ui.voice.date_set', { day: formatDate(date.day, 'full') }))}</label></p>`;
        } else if (date) {
            html += `<p class="voice-warn voice-unclear">${esc(t(date.why, { day: formatDate(date.day, 'full') }))}</p>`;
        }
        acc.unclear.forEach(u => { html += `<p class="voice-warn voice-unclear">${esc(t('ui.voice.unclear', { heard: u }))}</p>`; });
        const counted = lines.filter(l => !l.unticked && complete(l));
        if (counted.length > 1 || (counted.length === 1 && hasExtras(acc))) {
            html += `<p class="voice-lines-total">${esc(t('ui.voice.lines_total', { amount: formatRupees(voiceLinesTotal(counted)) }))}</p>`;
        }
        html += `<p class="voice-note">${esc(simple
            ? t('ui.voice.check_note', { ok: t('ui.voice.fill_bill'), add: t('ui.common.add_bill') })
            : t('ui.voice.sheet_note', { fill: t('ui.voice.fill_bill') }))}</p>`;
        html += `<div class="voice-part"><button type="button" class="btn btn-tonal" data-voice-hold="${esc(sheet.key)}" `
            + `aria-label="${esc(t('ui.voice.hold_more'))}" title="${esc(t('ui.voice.hold_more_title'))}">`
            + '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-mic"/></svg>'
            + `<span>${esc(t('ui.voice.hold_more'))}</span></button>`
            + '<p class="voice-transcript" id="voiceSheetLive" role="status" aria-live="polite"></p></div>';
        if (localVoice(this.lang())) {
            html += `<p class="voice-readback"><label><input type="checkbox" id="voiceReadback" data-onchange="voice.setReadback(this.checked)"${Readback.isOn() ? ' checked' : ''}> ${esc(t('ui.voice.readback'))}</label></p>`;
        }
        return html + '</div>';
    },

    partyHtml(f, party, choice) {
        if (!party) return '';
        const label = esc(head(f.key === 'sale' ? 'ui.billing.customer_label' : 'ui.billing.supplier_label'));
        const current = String(byId(f.customer)?.value || '').trim();
        const matches = party.matches || [];
        const name = this.partyName({ ...party, skip: false }, choice);
        let html = `<p class="voice-customer"><label><input type="checkbox" id="voiceCustomerTick"${party.skip ? '' : ' checked'}> ${label}</label> `;
        const unsure = matches.length > 0 && !party.sure && choice === null;
        if (matches.length) {
            const selected = choice ?? (party.sure ? `m${Math.max(0, matches.indexOf(party.sure))}` : 'spoken');
            const options = matches.map((m, i) => `<option value="m${esc(i)}"${selected === `m${i}` ? ' selected' : ''}>${esc(m.name)} · ${esc(dueText(f.kind, m))}</option>`);
            options.push(`<option value="spoken"${selected === 'spoken' ? ' selected' : ''}>${esc(t('ui.voice.use_spoken', { name: party.spoken }))}</option>`);
            html += `<select class="input${unsure ? ' voice-unclear' : ''}" id="voicePartyPick" aria-label="${label}">${options.join('')}</select></p>`;
            if (unsure) html += `<p class="voice-warn voice-unclear">${esc(t('ui.voice.party_unsure', { name: party.spoken }))}</p>`;
            else if (party.sure && selected !== 'spoken') html += `<p class="voice-hint">${esc(t('ui.voice.party_matched', { heard: party.spoken, name: party.sure.name }))}</p>`;
        } else {
            html += `<strong>${esc(party.spoken)}</strong></p>`;
        }
        if (current && name && current !== name) html += `<p class="voice-warn">${esc(t('ui.voice.customer_replaces', { name: current }))}</p>`;
        return html;
    },

    linesHtml(lines, simple) {
        const missing = `<em>${esc(t('ui.voice.not_heard'))}</em>`;
        const val = (v) => (v !== null && v !== undefined ? esc(v) : missing);
        const kg = (line) => (Array.isArray(line.weights) && line.weights.length > 1
            ? `${esc(line.weights.join(' + '))} = ${esc(line.weight)}` : val(line.weight));
        const money = (line) => { const a = lineAmount(line); return a === null ? '' : esc(formatRupees(a)); };
        const warns = (line, i) => (line.extraNumbers ? `<p class="voice-warn" data-voice-warn="${esc(i)}">${esc(t('ui.voice.extra_numbers'))}</p>` : '')
            + (line.rateUnusual ? `<p class="voice-warn" data-voice-warn="${esc(i)}">${esc(t('ui.voice.rate_unusual'))}</p>` : '');
        if (simple) {
            const [line] = lines;
            const row = (label, name, value) => `<tr><th scope="row">${esc(label)}</th><td data-voice-cell="${esc(name)}">${value}</td></tr>`;
            return '<table class="voice-check"><tbody data-voice-row="0">'
                + row(t('ui.common.item'), 'item', line.item ? esc(itemLabel(line.item)) : missing)
                + row(t('ui.billing.weight_kg'), 'weight', kg(line))
                + row(t('ui.billing.rate'), 'rate', val(line.rate))
                + (complete(line) ? row(head('ui.common.total'), 'amount', money(line)) : '')
                + '</tbody></table>' + warns(line, 0)
                + `<p class="voice-edit-bar">${this.editButtonHtml(0)}</p>` + this.editorHtml(line, 0);
        }
        let html = `<table class="voice-check voice-lines"><thead><tr><th scope="col">${esc(t('ui.voice.tick_head'))}</th>`
            + `<th scope="col">${esc(head('ui.common.item'))}</th><th scope="col">${esc(head('ui.billing.weight_kg'))}</th><th scope="col">${esc(head('ui.billing.rate'))}</th>`
            + `<th scope="col">${esc(head('ui.common.total'))}</th><th scope="col">${esc(t('ui.voice.correct_head'))}</th></tr></thead>`;
        lines.forEach((line, i) => {
            const ok = complete(line);
            html += `<tbody data-voice-row="${esc(i)}"${ok ? '' : ' class="voice-unclear"'}><tr><td><input type="checkbox" data-voice-line="${esc(i)}" aria-label="${esc(t('ui.voice.tick_line'))}"${ok && !line.unticked ? ' checked' : ''}${ok ? '' : ' disabled'}></td>`
                + `<td data-voice-cell="item">${line.item ? esc(itemLabel(line.item)) : missing}</td><td data-voice-cell="weight">${kg(line)}</td><td data-voice-cell="rate">${val(line.rate)}</td>`
                + `<td data-voice-cell="amount">${money(line)}</td><td>${this.editButtonHtml(i)}</td></tr>`;
            const notes = (ok ? '' : `<p class="voice-warn" data-voice-incomplete="${esc(i)}">${esc(t('ui.voice.line_incomplete'))}</p>`) + warns(line, i);
            html += `<tr class="voice-line-notes"><td></td><td colspan="5">${notes}${this.editorHtml(line, i)}</td></tr></tbody>`;
        });
        return html + '</table>';
    },

    labourHtml(f, labour) {
        if (!labour) return '';
        if (!f.labour) return `<p class="voice-warn voice-unclear">${esc(t('ui.voice.labour_purchase_only'))}</p>`;
        if (!labour.on) return `<p class="voice-part"><label><input type="checkbox" id="voiceLabourTick" checked> ${esc(t('ui.voice.labour_off'))}</label></p>`;
        if (labour.amount === null && labour.perBag === null) return `<p class="voice-part"><label><input type="checkbox" id="voiceLabourTick" checked> ${esc(t('ui.voice.labour_on'))}</label></p>`;
        const perBag = labour.perBag !== null;
        const label = perBag ? t('ui.voice.labour_per_bag') : head('ui.billing.labour_label');
        return `<p class="voice-part"><label><input type="checkbox" id="voiceLabourTick" checked> ${esc(label)}</label> `
            + `<span class="adorn voice-part-input"><span class="adorn-pre" aria-hidden="true">₹</span><input class="input" type="number" inputmode="decimal" min="0" step="any" id="voiceLabour" `
            + `value="${esc(perBag ? labour.perBag : labour.amount)}" aria-label="${esc(label)}"></span></p>`;
    },

    paymentHtml(pay) {
        const legs = /** @type {Array<'cash'|'online'|'due'>} */ (['cash', 'online', 'due']).filter(k => pay[k] !== null && pay[k] !== undefined);
        if (!legs.length && !pay.rest && !pay.full) return '';
        let html = `<div class="voice-part voice-pay"><p class="voice-part-title">${esc(t('ui.billing.payment'))}</p>`;
        legs.forEach(k => {
            html += `<p class="voice-pay-leg"><label for="voicePay-${esc(k)}">${esc(head(PAY_LABEL[k]))}</label> <span class="adorn voice-part-input"><span class="adorn-pre" aria-hidden="true">₹</span>`
                + `<input class="input" type="number" inputmode="decimal" min="0" step="any" id="voicePay-${esc(k)}" data-voice-pay="${esc(k)}" value="${esc(pay[k])}"></span></p>`;
        });
        if (pay.rest) html += `<p><label><input type="checkbox" id="voicePayRest" checked> ${esc(t(`ui.voice.rest_${pay.rest}`))}</label></p>`;
        if (pay.full) html += `<p><label><input type="checkbox" id="voicePayFull" checked> ${esc(t(`ui.voice.full_${pay.full}`))}</label></p>`;
        return html + '</div>';
    },

    /**
     * Fill bill: the party, then the lines (one line alone goes in the form as before; otherwise the ticked
     * lines are added, each through the form's own Add to bill), the rate, labour, the payment, the note and
     * the day. Like typing: nothing is saved.
     */
    async applySheet(f, sheet) {
        const acc = sheet.acc;
        let did = false;
        const name = this.partyName(acc.party, sheet.partyChoice);
        if (name && byId(f.customer)) {
            fillPartyName(f.kind, name);
            BillingManager.triggerAutoSave?.();
            did = true;
        }
        const lines = acc.lines.map(l => ({ ...l, item: lineItem(l) }));
        const used = lines.map((line, i) => this.correctedLine(line, i));
        if (used.some(l => l.edited)) track('voice.edit');
        const extras = hasExtras(acc);
        let message = name ? t('msg.voice.customer_filled', { name }) : '';
        if (used.length === 1 && !extras) {
            return this.fill(f, used[0], used[0].item) || did;
        }
        if (used.length === 1 && !complete(used[0])) {
            did = this.fill(f, used[0], used[0].item, false) || did;
        } else if (used.length) {
            const chosen = used.filter((l, i) => complete(l) && !l.unticked
                && (document.querySelector(`[data-voice-line="${i}"]`)?.checked ?? true));
            if (chosen.length) {
                const result = await this.addLines(f, chosen, true);
                if (result.added > 0) did = true;
                if (result.stopped) return did;
                message = t('msg.voice.lines_added', { n: result.added });
            } else message = t(name ? 'msg.voice.customer_filled' : 'msg.voice.nothing_added', { name });
        }
        if (acc.rate !== null && byId(f.rate)) {
            byId(f.rate).value = String(acc.rate);
            did = true;
        }
        did = this.applyLabour(f, acc.labour) || did;
        did = this.applyPayment(f, acc.payment) || did;
        if (acc.note && byId(f.note)) {
            const box = byId(f.note);
            const old = String(box.value || '').trim();
            box.value = old && !old.includes(acc.note) ? `${old} ${acc.note}` : acc.note;
            syncBillNotes(f.note, true);
            did = true;
        }
        const date = this.dateFor(f, acc.date);
        if (date?.ok) {
            const input = byId(f.date);
            input.value = date.day;
            if (date.day !== toLocalISODate(new Date())) input.dataset.picked = '1';
            else delete input.dataset.picked;
            input.dataset.open = '1';
            renderBillDateLine(f.date);
            did = true;
        }
        BillingManager.triggerAutoSave?.();
        if (extras && did) message = message ? `${message} ${t('msg.voice.bill_filled')}` : t('msg.voice.bill_filled');
        if (message) this.tell(f, message, 4000);
        return did;
    },

    applyLabour(f, labour) {
        if (!labour || !f.labour) return false;
        const box = byId(f.labour);
        const on = byId(f.labourOn);
        if (!box || !on) return false;
        on.checked = !!labour.on;
        if (labour.on && (labour.amount !== null || labour.perBag !== null)) {
            const amount = labour.amount !== null ? labour.amount : labourForBags(labour.perBag, f.heavyPackets());
            box.value = String(amount);
            box.dataset.manuallySet = 'true';
        }
        f.totalsChanged();
        return true;
    },

    applyPayment(f, pay) {
        if (!pay) return false;
        const set = (k, v) => {
            const el = byId(f[k]);
            if (!el) return;
            el.value = String(v);
            const tick = payBox(f, k);
            if (tick) tick.checked = false;
        };
        let did = false;
        if (pay.full) {
            // As tapping that leg's Fill box
            const box = payBox(f, pay.full);
            if (box) box.checked = true;
            f.fillAll(pay.full);
            return true;
        }
        for (const k of /** @type {Array<'cash'|'online'|'due'>} */ (['cash', 'online', 'due'])) {
            if (pay[k] !== null && pay[k] !== undefined) {
                set(k, pay[k]);
                did = true;
            }
        }
        if (did) f.payChanged();
        if (pay.rest === 'due') {
            f.restToDue();
            did = true;
        } else if (pay.rest) {
            const split = f.split();
            const other = pay.rest === 'cash' ? 'online' : 'cash';
            const rest = restInDue(f.total(), { cash: split.due || 0, online: split[other] || 0 });
            if (rest.ok) {
                set(pay.rest, rest.due);
                f.payChanged();
                did = true;
            } else UIManager.showToast(t('msg.voice.rest_too_much'), 4000);
        }
        return did;
    },

    /** A toast that also goes in the transcript strip, after what was heard. */
    tell(f, message, ms) {
        this.setStrip(f, this.heardNow, message);
        UIManager.showToast(message, ms);
    },

    /** The transcript strip under the mic (aria-live): what was heard and what came of it. */
    setStrip(f, heard, status) {
        const el = byId(f.transcript);
        if (!el) return;
        el.textContent = [heard ? t('ui.voice.transcript', { heard }) : '', status || ''].filter(Boolean).join(' ');
    },

    /** The Undo button shows while this form has a voice change to undo. */
    refreshUndo(mode) {
        const key = formKey(mode);
        const btn = byId(FIELDS[key].undo);
        if (btn) btn.hidden = this.undo[key].size === 0;
    },

    /**
     * Undoes the form's last voice change (the Undo button, or "undo" / "वापस" said): removes
     * the lines it added and puts back the boxes it filled, where they are still as voice left them.
     * @param {'purchase'|'sale'} mode
     * @param {boolean} [spoken] said into the mic (the listen is already running)
     * @returns {boolean} true when something was undone
     */
    undoLast(mode, spoken = false) {
        const key = formKey(mode);
        const f = FIELDS[key];
        if ((this.busy || this.listening) && !spoken) return false;
        if (!spoken) this.heardNow = '';
        if (Helpers.isBusy(f.lock)) {
            this.tell(f, t('msg.voice.finish_saving'), 4000);
            return false;
        }
        const plan = planUndo(this.undo[key].peek(), { lines: f.lines(), fields: boxes(f) });
        if (('item' in plan.restore || 'rate' in plan.restore) && (f.pending().length > 0 || f.editing())) {
            this.tell(f, t('msg.voice.finish_weights'), 4000);
            return false;
        }
        this.undo[key].pop();
        this.refreshUndo(key);
        if (!plan.any) {
            this.tell(f, t('msg.voice.undo_none'), 4000);
            return false;
        }
        plan.removeAt.forEach(i => f.removeLine(i));
        const set = (id, v) => { const el = byId(id); if (el) el.value = v; };
        if ('customer' in plan.restore) set(f.customer, plan.restore.customer);
        if ('item' in plan.restore) {
            const rate = String(byId(f.rate)?.value ?? '');
            set(f.item, plan.restore.item);
            f.loadRates();
            set(f.rate, 'rate' in plan.restore ? plan.restore.rate : rate);
        } else if ('rate' in plan.restore) set(f.rate, plan.restore.rate);
        if ('weight' in plan.restore) set(f.weight, plan.restore.weight);
        if ('note' in plan.restore) {
            set(f.note, plan.restore.note);
            syncBillNotes(f.note);
        }
        if (f.labour && ['labourOn', 'labour', 'labourTyped'].some(k => k in plan.restore)) {
            if ('labourOn' in plan.restore && byId(f.labourOn)) byId(f.labourOn).checked = plan.restore.labourOn !== '0';
            if ('labour' in plan.restore) set(f.labour, plan.restore.labour);
            if ('labourTyped' in plan.restore && byId(f.labour)) {
                if (plan.restore.labourTyped === '1') byId(f.labour).dataset.manuallySet = 'true';
                else delete byId(f.labour).dataset.manuallySet;
            }
            f.totalsChanged();
        }
        if (['cash', 'online', 'due'].some(k => k in plan.restore)) {
            ['cash', 'online', 'due'].forEach(k => { if (k in plan.restore) set(f[k], plan.restore[k]); });
            f.payChanged();
        }
        BillingManager.triggerAutoSave?.();
        track('voice.undo');
        this.tell(f, t(plan.kept ? 'msg.voice.undo_partly' : 'msg.voice.undone'), 4000);
        return true;
    },

    /** The sheet's line i, with what was typed in its Correct boxes (when changed). */
    correctedLine(line, i) {
        const box = document.querySelector(`[data-voice-edit="${i}"]`);
        if (!box || box.dataset.changed !== '1') return line;
        const items = this.checking?.items || AppState.items;
        const pick = box.querySelector('[data-voice-field="item"]')?.value ?? '';
        const item = pick === '' ? null : items[Number(pick)] || null;
        const weight = typedNumber(box.querySelector('[data-voice-field="weight"]')?.value);
        return {
            ...line,
            itemIndex: item ? AppState.items.indexOf(item) : null,
            item,
            weight,
            weights: Array.isArray(line.weights) && weight === line.weight ? line.weights : undefined,
            rate: typedNumber(box.querySelector('[data-voice-field="rate"]')?.value),
            extraNumbers: false,
            rateUnusual: false,
            edited: true
        };
    },

    /** Opens or closes line i's Correct boxes in the check sheet. */
    editLine(i) {
        const n = Number(i);
        const box = document.querySelector(`[data-voice-edit="${n}"]`);
        if (!box) return;
        box.hidden = !box.hidden;
        document.querySelector(`[data-voice-edit-btn="${n}"]`)?.setAttribute('aria-expanded', String(!box.hidden));
        if (!box.hidden) box.querySelector('select, input')?.focus();
    },

    /** A Correct box changed: the row shows the new values, and a line now complete can be ticked. */
    lineChanged(i) {
        const n = Number(i);
        const box = document.querySelector(`[data-voice-edit="${n}"]`);
        const line = this.checking?.lines?.[n];
        if (!box || !line) return;
        box.dataset.changed = '1';
        const now = this.correctedLine(line, n);
        const row = document.querySelector(`[data-voice-row="${n}"]`);
        const cell = (name, v) => {
            const c = row?.querySelector(`[data-voice-cell="${name}"]`);
            if (!c) return;
            if (v !== null && v !== '') {
                c.textContent = String(v);
                return;
            }
            const em = document.createElement('em');
            em.textContent = t('ui.voice.not_heard');
            c.replaceChildren(em);
        };
        cell('item', now.item ? itemLabel(now.item) : null);
        cell('weight', now.weight);
        cell('rate', now.rate);
        const amount = row?.querySelector('[data-voice-cell="amount"]');
        if (amount) amount.textContent = complete(now) ? formatRupees(lineAmount(now)) : '';
        const ok = complete(now);
        const tick = document.querySelector(`[data-voice-line="${n}"]`);
        if (tick) {
            if (ok && tick.disabled) tick.checked = true;
            if (!ok) tick.checked = false;
            tick.disabled = !ok;
        }
        row?.classList.toggle('voice-unclear', !ok && !!tick);
        const note = document.querySelector(`[data-voice-incomplete="${n}"]`);
        if (note) note.hidden = ok;
        document.querySelectorAll(`[data-voice-warn="${n}"]`).forEach(w => { w.hidden = true; });
    },

    /** Line i's Correct boxes: item, weight (kg) and rate, filled with what was heard. */
    editorHtml(line, i) {
        const items = this.checking?.items || AppState.items;
        const at = line.item ? items.indexOf(line.item) : -1;
        const options = [`<option value="">${esc(t('ui.voice.pick_item'))}</option>`];
        items.forEach((it, k) => {
            if (!it || (isArchivedItem(it) && k !== at)) return;
            options.push(`<option value="${esc(k)}"${k === at ? ' selected' : ''}>${esc(itemLabel(it))}</option>`);
        });
        const num = (field, label, v, pre, post) => `<label class="field voice-edit-field"><span>${esc(label)}</span><span class="adorn">`
            + (pre ? `<span class="adorn-pre" aria-hidden="true">${esc(pre)}</span>` : '')
            + `<input class="input" type="number" inputmode="decimal" min="0" step="any" data-voice-field="${esc(field)}" value="${v !== null && v !== undefined ? esc(v) : ''}" data-oninput="voice.lineChanged(${esc(i)})">`
            + `<span class="adorn-post" aria-hidden="true">${esc(post)}</span></span></label>`;
        return `<div class="voice-edit" id="voiceEdit${esc(i)}" data-voice-edit="${esc(i)}" hidden>`
            + `<label class="field voice-edit-field"><span>${esc(head('ui.common.item'))}</span>`
            + `<select class="input" data-voice-field="item" data-onchange="voice.lineChanged(${esc(i)})">${options.join('')}</select></label>`
            + num('weight', head('ui.billing.weight_label'), line.weight, '', 'kg')
            + num('rate', head('ui.common.rate'), line.rate, '₹', '/kg')
            + '</div>';
    },

    /** The button that opens line i's Correct boxes. */
    editButtonHtml(i) {
        return `<button type="button" class="btn btn-ghost btn-sm voice-edit-btn" data-voice-edit-btn="${esc(i)}" aria-expanded="false" `
            + `aria-controls="voiceEdit${esc(i)}" data-onclick="voice.editLine(${esc(i)})">${esc(t('ui.voice.correct'))}</button>`;
    },

    /** The mute switch in the check sheet: per device, stops or restarts the readback. */
    setReadback(on) {
        Readback.setOn(!!on);
        if (on && this.spoken) Readback.speak(this.spoken.text, this.spoken.lang);
    },

    /** What the readback says: the party, each line's item, weight and rate, then the payment, labour, note and day. */
    readbackText(customer, lines, bill = null, key = 'purchase') {
        const role = bill?.party?.role || (key === 'sale' ? 'customer' : 'supplier');
        const parts = customer ? [t(role === 'supplier' && bill ? 'ui.voice.say_supplier' : 'ui.voice.say_customer', { name: customer })] : [];
        for (const line of lines) {
            const bits = [
                line.item ? spokenLabel(line.item) : '',
                line.weight !== null ? t('ui.voice.say_weight', { weight: line.weight }) : '',
                line.rate !== null ? t('ui.voice.say_rate', { rate: line.rate }) : ''
            ].filter(Boolean);
            if (bits.length) parts.push(bits.join(', '));
        }
        if (bill) {
            const pay = bill.payment;
            if (bill.rate !== null) parts.push(t('ui.voice.say_rate', { rate: bill.rate }));
            if (bill.labour) {
                parts.push(!bill.labour.on ? t('ui.voice.labour_off')
                    : bill.labour.amount !== null ? t('ui.voice.say_labour', { amount: bill.labour.amount })
                        : bill.labour.perBag !== null ? t('ui.voice.say_labour_bag', { amount: bill.labour.perBag }) : t('ui.voice.labour_on'));
            }
            ['cash', 'online', 'due'].forEach(k => { if (pay[k] !== null) parts.push(t(`ui.voice.say_${k}`, { amount: pay[k] })); });
            if (pay.rest) parts.push(t(`ui.voice.rest_${pay.rest}`));
            if (pay.full) parts.push(t(`ui.voice.full_${pay.full}`));
            if (bill.note) parts.push(t('ui.voice.say_note', { note: bill.note }));
        }
        return parts.join('. ');
    },

    /**
     * Picks the line's item in the form (found again by identity: the list can change
     * while the sheet is open). Refuses to move weights already entered for another item.
     * @returns {boolean}
     */
    selectItem(f, item) {
        if (!item) return true;
        const select = byId(f.item);
        const at = AppState.items.findIndex(i => i === item || (item.id && i?.id === item.id));
        const want = String(at);
        if (at === -1 || !select || ![...select.options].some(o => o.value === want)) {
            this.tell(f, t('msg.voice.item_changed'), 4000);
            return false;
        }
        if (select.value !== want) {
            if (f.pending().length > 0) {
                this.tell(f, t('msg.voice.finish_weights'), 4000);
                return false;
            }
            select.value = want;
            f.loadRates();
        }
        return true;
    },

    /** Puts the checked values in the form; the user still taps Add to Bill and Save. */
    fill(f, line, item, say = true) {
        if (!this.selectItem(f, item)) return false;
        const rate = byId(f.rate);
        if (rate && line.rate !== null) rate.value = String(line.rate);
        const weight = byId(f.weight);
        if (Array.isArray(line.weights) && line.weights.length > 1) {
            if (f.pending().length > 0 || String(weight?.value || '').trim()) {
                this.tell(f, t('msg.voice.finish_weights'), 4000);
                return false;
            }
            f.addWeights(line.weights);
        } else if (weight && line.weight !== null) weight.value = String(line.weight);
        BillingManager.triggerAutoSave?.();
        if (say) this.tell(f, t('msg.voice.filled', { add: t('ui.common.add_bill') }), 4000);
        return true;
    },

    /**
     * Several lines (#81 A2): each ticked line goes through the form's own Add to Bill,
     * with its checks (bag weight, rate), one after another; bag weights go in as chips first.
     * A line those checks stop stays in the form and the rest are not added. Never saves.
     * @returns {Promise<any>} true when at least one line was added ({added, stopped} with `detail`)
     */
    async addLines(f, lines, detail = false) {
        const out = (added, stopped) => (detail ? { added, stopped } : added > 0);
        if (f.pending().length > 0 || String(byId(f.weight)?.value || '').trim()) {
            this.tell(f, t('msg.voice.finish_weights'), 4000);
            return out(0, true);
        }
        let added = 0;
        for (const line of lines) {
            if (!this.selectItem(f, line.item)) return out(added, true);
            byId(f.rate).value = String(line.rate);
            if (Array.isArray(line.weights) && line.weights.length > 1) {
                byId(f.weight).value = '';
                f.addWeights(line.weights);
            } else byId(f.weight).value = String(line.weight);
            const before = f.lineCount();
            await f.addLine();
            if (f.lineCount() === before) {
                this.tell(f, t('msg.voice.lines_stopped', { n: added, total: lines.length, add: t('ui.common.add_bill') }), 6000);
                return out(added, true);
            }
            added++;
        }
        if (!detail) this.tell(f, t('msg.voice.lines_added', { n: added }), 4000);
        return out(added, false);
    },

    /**
     * The mic in the name field (#498): listen once, then the known parties closest to what was
     * said (any script, honorifics left out) and "Use '<as said>'". Nothing is picked for the user;
     * a pick fills the field as typing would (the due line and suggestions follow).
     * @param {'purchase'|'sale'} mode
     * @param {'native'|'web'} engine
     * @returns {Promise<boolean>} true when the name was filled
     */
    async listenName(mode, engine) {
        const key = formKey(mode);
        const f = FIELDS[key];
        if (this.listening || this.busy) return false;
        this.listening = true;
        this.heardNow = '';
        const mic = byId(f.nameMic);
        this.showListening(f, mic, true, t('msg.voice.name_listening'));
        let heard;
        try {
            heard = engine === 'native'
                ? await listenNative(this.lang(), window.Capacitor?.Plugins?.SpeechRecognition)
                : await listenWeb(this.lang());
        } catch (e) {
            this.listenFailed(f, e);
            return false;
        } finally {
            this.listening = false;
            this.showListening(f, mic, false);
        }
        const names = [...new Set((heard || []).map(nameFromSpeech).filter(Boolean))];
        if (!names.length) {
            beep('fail');
            this.setStrip(f, '', t('msg.voice.no_speech'));
            UIManager.showToast(t('msg.voice.no_speech'));
            return false;
        }
        beep('ok');
        const spoken = names[0];
        this.heardNow = spoken;
        /** @type {Map<string, any>} */
        const best = new Map();
        names.forEach((n, alt) => this.partyMatches(f, n).matches.forEach(m => {
            const score = m.score + alt * 0.5;
            if (!best.has(m.key) || best.get(m.key).score > score) best.set(m.key, { ...m, score });
        }));
        const matches = [...best.values()].sort((a, b) => a.score - b.score).slice(0, 5);
        const contacts = !!contactPickerKind(window) && !document.body.classList.contains('no-perm-contacts');
        const pick = (v, cls, label, sub = '') => `<button type="button" class="btn ${esc(cls)} voice-name-pick" data-onclick="voice.pickName('${esc(v)}')">`
            + `<span class="voice-name-pick-name">${esc(label)}</span>${sub ? `<span class="voice-name-pick-due">${esc(sub)}</span>` : ''}</button>`;
        const label = head(key === 'sale' ? 'ui.billing.customer_label' : 'ui.billing.supplier_label');
        let html = `<div id="voiceNamePick" class="voice-name-sheet"><h2 class="voice-name-title">${esc(t('ui.voice.name_pick_title', { field: label }))}</h2>`
            + `<p class="voice-heard">${esc(t('ui.voice.heard'))} <q>${esc(heard.find(h => String(h || '').trim()) || spoken)}</q></p>`;
        if (matches.length) {
            html += `<p class="voice-note">${esc(t('ui.voice.name_pick_note'))}</p><div class="voice-name-list" role="group" aria-label="${esc(t('ui.voice.name_pick_title', { field: label }))}">`
                + matches.map((m, i) => pick(`m${i}`, 'btn-tonal', m.name, dueText(f.kind, m))).join('') + '</div>';
        } else html += `<p class="voice-note">${esc(t('ui.voice.name_no_match', { name: spoken }))}</p>`;
        html += `<div class="voice-name-list">${pick('spoken', 'btn-ghost', t('ui.voice.use_spoken', { name: spoken }))}`
            + (contacts ? pick('contacts', 'btn-ghost', t('ui.voice.name_from_contacts')) : '') + '</div></div>';
        const choice = await UIManager.showCustomModal(html, [{ text: t('ui.modals.cancel'), value: null, class: 'btn btn-ghost' }]);
        if (!choice) {
            this.setStrip(f, spoken, t('ui.voice.strip_cancelled'));
            return false;
        }
        if (choice === 'contacts') {
            await Helpers.pickContact(f.customer);
            return !!String(byId(f.customer)?.value || '').trim();
        }
        const name = choice === 'spoken' ? spoken : matches[Number(String(choice).slice(1))]?.name;
        if (!name) return false;
        const before = boxes(f);
        fillPartyName(f.kind, name);
        BillingManager.triggerAutoSave?.();
        if (this.undo[key].push({ lines: [], fields: fieldChanges(before, boxes(f)) })) this.refreshUndo(key);
        this.tell(f, t('msg.voice.name_filled', { name }), 4000);
        return true;
    }
};

// A saved or cleared bill ends its voice changes: Undo is never offered across bills.
on(BILL_CLEARED, (mode) => {
    VoiceBilling.undo[formKey(mode)].clear();
    VoiceBilling.refreshUndo(mode);
});
