/**
 * @fileoverview Reports › Trends and Product traffic text follows the app language (#143): the
 * page is rendered in English and in Hindi and must not show the other
 * language (it used to show every string as "English / हिंदी").
 */
jest.mock('../firebase/firestore-service.js', () => ({
    FirebaseService: {
        historyServerSynced: jest.fn(() => false),
        loadRateStatsMeta: jest.fn(),
        loadRateStatsForItem: jest.fn(),
        loadRateStatsForYear: jest.fn(),
        loadRateHistory: jest.fn(),
        oldestBillTimestamp: jest.fn(async () => Date.UTC(2023, 0, 1)),
        loadServerRateStatsFromYear: jest.fn(async () => ({ docs: [], more: false })),
        saveRateStats: jest.fn(async () => {})
    }
}));

const fs = require('fs');
const path = require('path');
import { RateTrendsManager } from '../modules/rate-trends.js';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AppState } from '../utils/state.js';
import { applyTranslations, setLang, resetLangForTests } from '../i18n/index.js';
import { billsToYearDocs, istMonthKey } from '../utils/rate-trends.js';
import { historyDocId } from '../utils/rate-history.js';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'rate-trends.html'), 'utf8');
const DEVANAGARI = /[\u0900-\u097F]/;
const now = Date.now();
const items = [{ id: 'wheat', name: 'Wheat', hindiName: 'गेहूं', rates: [26], wholesaleRates: [28], saleRates: [30] }];
const bills = [
    { id: 'p1', timestamp: now - 400 * 86400000, items: [{ itemId: 'wheat', rate: 22, qty: 100 }] },
    { id: 'p2', timestamp: now - 40 * 86400000, items: [{ itemId: 'wheat', rate: 24, qty: 100 }] },
    { id: 'p3', timestamp: now - 3600000, items: [{ itemId: 'wheat', rate: 25, qty: 50 }] }
];
const yearDocs = Object.entries(billsToYearDocs({ purchase: bills }, items)).map(([id, d]) => ({ id, ...d }));

async function renderPage(lang, meta) {
    resetLangForTests();
    localStorage.clear();
    setLang(lang);
    document.body.innerHTML = TEMPLATE;
    applyTranslations(document);
    FirebaseService.loadRateStatsMeta.mockResolvedValue(meta);
    Object.assign(RateTrendsManager, {
        meta: undefined, metaError: null, estimate: null, series: null, seriesItemId: null, itemId: null,
        section: 'rates', view: 'chart', period: 'week', traffic: null, trafficItemId: null, trafficMonth: null
    });
    RateTrendsManager.statsByItem.clear();
    RateTrendsManager.yearDocs.clear();
    await RateTrendsManager.init();
    const texts = [document.body.textContent];
    await RateTrendsManager.setView('table');
    texts.push(document.body.textContent);
    await RateTrendsManager.setSection('traffic');
    texts.push(document.body.textContent);
    texts.push([...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).join(' '));
    return texts.join('\n');
}

beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
});

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    AppState.userRole = 'owner';
    AppState.currentUser = { uid: 'own1' };
    AppState.items = items;
    AppState.purchaseHistory = bills;
    AppState.retailSalesHistory = [];
    AppState.salesHistory = [];
    AppState.historyLoadedFrom = 0;
    FirebaseService.loadRateStatsForItem.mockResolvedValue(yearDocs);
    FirebaseService.loadRateStatsForYear.mockImplementation(async (y) => ({ docs: yearDocs.filter(d => d.year === String(y)), more: false }));
    FirebaseService.loadRateHistory.mockResolvedValue([
        { id: historyDocId('wheat', now - 86400000), field: 'purchase', old: 25, new: 26, at: now - 86400000 }
    ]);
});

afterEach(() => {
    resetLangForTests();
    localStorage.clear();
});

const built = () => ({ backfillDone: true, backfillAt: now - 10 * 86400000, bills: 3 });

test('English: no Hindi text anywhere on the page (history built and not yet built)', async () => {
    const text = await renderPage('en', built());
    expect(text).toMatch(/Rate changes on Items & rates/);
    expect(text).toMatch(/Items moved in the month/);
    expect(text).toContain('₹25 → ₹26');
    expect(text).toMatch(/Week of \d+ [A-Z][a-z]{2} 20\d\d/);
    expect(text).toMatch(/Usually|Not enough history/);
    expect(text).not.toMatch(DEVANAGARI);
    expect(text).not.toMatch(/ \/ [\u0900-\u097F]/);

    const fresh = await renderPage('en', null);
    expect(fresh).toMatch(/Build history from all bills/);
    expect(fresh).not.toMatch(DEVANAGARI);
});

test('U-76: when no rate has enough history, one line says so (not three identical cards)', async () => {
    await renderPage('en', built());
    const none = document.querySelectorAll('#rtOutlook .rt-outlook-none');
    const all = document.querySelectorAll('#rtOutlook .rt-outlook');
    if (none.length === all.length) {
        expect(all).toHaveLength(1);
        expect(all[0].textContent).toContain('Not enough history yet to show rate trends');
    } else {
        expect(all).toHaveLength(3);
    }
});

test('Hindi: no English sentences from the catalogue on the page', async () => {
    const text = await renderPage('hi', built());
    expect(text).toMatch(/आइटम और रेट पेज पर रेट में बदलाव/);
    expect(text).toContain('₹25 → ₹26');
    expect(text).toMatch(/वाला हफ़्ता/);
    for (const en of ['Trends', 'Rates page', 'Items & rates', 'Items page', 'Estimated from bills', 'Purchase', 'Wholesale', 'Retail', 'Weekly',
        'Month', 'Week', 'Bills', 'Not enough history', 'Day by day', 'Product traffic', 'History built']) {
        expect(text).not.toContain(en);
    }
    const fresh = await renderPage('hi', null);
    expect(fresh).not.toMatch(/Build history|Reads per day|free limit/);
    expect(fresh).toMatch(/सभी बिलों से इतिहास बनाएँ/);
});

test('chart greys come from the theme tokens and are redrawn when the theme or mode changes', async () => {
    await renderPage('en', built());
    await RateTrendsManager.setSection('rates');
    await RateTrendsManager.setView('chart');
    const styles = [];
    const ctx = new Proxy({}, {
        get: (o, k) => (k in o ? o[k] : () => {}),
        set: (o, k, v) => { if (k === 'fillStyle' || k === 'strokeStyle') styles.push(v); o[k] = v; return true; }
    });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => ctx;
    const offsetParent = jest.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
    const root = document.documentElement.style;
    root.setProperty('--ink-2', '#a8a8b5');
    root.setProperty('--line', 'rgba(255, 255, 255, 0.07)');
    try {
        window.dispatchEvent(new CustomEvent('aadhat:themechange', { detail: { mode: 'dark' } }));
        expect(styles).toEqual(expect.arrayContaining(['#a8a8b5', 'rgba(255, 255, 255, 0.07)']));
        expect(styles).not.toEqual(expect.arrayContaining(['#4b5563']));
    } finally {
        HTMLCanvasElement.prototype.getContext = getContext;
        offsetParent.mockRestore();
        root.removeProperty('--ink-2');
        root.removeProperty('--line');
    }
});