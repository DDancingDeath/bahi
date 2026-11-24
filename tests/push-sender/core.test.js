/**
 * Push sender core (push-sender/Core.js): who gets which push, its text, stale tokens, and the
 * REST calls with an injected fetch / token (as in Apps Script).
 */
import PushCore from '../../push-sender/Core.js';
import { describeNotification } from '../../www/js/utils/notification-format.js';

const P = 'bahi-happa';
const ROOT = `projects/${P}/databases/(default)/documents`;
const value = (v) => (typeof v === 'boolean' ? { booleanValue: v }
    : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
        : Array.isArray(v) ? { arrayValue: { values: v.map(value) } }
            : v && typeof v === 'object' ? { mapValue: { fields: fields(v) } } : { stringValue: v });
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v)]));
const restDoc = (path, data) => ({ name: `${ROOT}/${path}`, fields: fields(data) });
const notif = (id, data) => PushCore.decodeDoc(restDoc(`notifications/${id}`, data));
const device = (uid, id, data) => PushCore.decodeDoc(restDoc(`users/${uid}/devices/${id}`, data));

const rate = { type: 'rate_change', userId: 'u1', itemName: 'Wheat', itemHindiName: 'गेहूं', rateType: 'sale', oldRate: 24.5, newRate: 2400, changedBy: 'Ram', timestamp: '2026-11-23T05:00:00Z' };

describe('push text matches the bell', () => {
    const cases = [
        rate,
        { ...rate, rateType: 'wholesale', oldRate: [20, 21], newRate: [22.75] },
        { type: 'item_edit', action: 'added', itemName: 'Rice', changedBy: 'Sita' },
        { type: 'item_edit', action: 'updated', itemName: 'Rice', itemHindiName: 'चावल', fields: ['name', 'contactPerson', 'x'] },
        { type: 'role_change', newRole: 'manager', changedBy: 'Owner A' },
        { type: 'edit', documentType: 'retailSales', billNumber: 'R-12', editedBy: 'Ram' },
        { type: 'cash_open', amount: 2000, changedBy: 'Ram' },
        { type: 'cash_close', amount: 12500.5, difference: -40.5, changedBy: 'Ram' },
        { type: 'cash_close', amount: 900, difference: 12, changedBy: '' },
        { type: 'cash_close', amount: 900, difference: 0, changedBy: 'Sita' },
        { type: 'test', changedBy: 'Ram' },
        { type: 'stale_outbox', message: 'Writes not sent', messageHi: 'नहीं भेजा', byName: 'Ram' },
        { type: 'mystery' }
    ];
    test.each(cases.map((c, i) => [i, c]))('case %i', (_, n) => {
        const d = describeNotification(n);
        const p = PushCore.describe(n);
        expect({ en: p.en, hi: p.hi, who: p.who }).toEqual({ en: d.en, hi: d.hi, who: d.who });
    });

    test('decoded REST values give the same text', () => {
        const back = notif('x', rate).data;
        expect(PushCore.pushText(back, 'en')).toBe(PushCore.pushText(rate, 'en'));
    });

    test('rupees as formatRate writes them', () => {
        expect(PushCore.rupees(25)).toBe('₹25');
        expect(PushCore.rupees(24.5)).toBe('₹24.50');
        expect(PushCore.rupees(123456.75)).toBe('₹1,23,456.75');
    });

    test('device language and who', () => {
        expect(PushCore.pushText(rate, 'hi')).toBe('गेहूं: फुटकर रेट ₹24.50 → ₹2,400 — Ram');
        expect(PushCore.pushText(rate, 'en')).toBe('Wheat: Retail rate ₹24.50 → ₹2,400 — Ram');
        expect(PushCore.pushText({ type: 'cash_close', amount: 12500, difference: -40.5, changedBy: 'Ram' }, 'en')).toBe('Cash closed by Ram · counted ₹12,500 · short ₹40.50');
        expect(PushCore.pushText({ type: 'cash_open', amount: 2000, changedBy: 'Ram' }, 'hi')).toBe('Ram ने नकद खोला · ₹2,000 शुरुआती');
    });
});

describe('who gets what', () => {
    const on = { on: true, token: 't', kinds: {} };
    test('master switch, bell switch and per-kind switches', () => {
        expect(PushCore.wants(on, 'rate_change')).toBe(true);
        expect(PushCore.wants({ ...on, on: false }, 'rate_change')).toBe(false);
        expect(PushCore.wants({ ...on, kinds: { bell: false } }, 'rate_change')).toBe(false);
        expect(PushCore.wants({ ...on, kinds: { rate: false } }, 'rate_change')).toBe(false);
        expect(PushCore.wants({ ...on, kinds: { rate: false } }, 'item_edit')).toBe(true);
        expect(PushCore.wants({ ...on, kinds: { cashClose: false } }, 'cash_close')).toBe(false);
        expect(PushCore.wants({ ...on, token: '' }, 'rate_change')).toBe(false);
    });

    test('one message per device; several notifications → "Bahi: 2 new"; pushed or read docs skipped', () => {
        const docs = [
            notif('a_u1', rate),
            notif('b_u1', { ...rate, type: 'item_edit', action: 'added', timestamp: '2026-11-23T06:00:00Z' }),
            notif('c_u1', { ...rate, pushed: true }),
            notif('d_u1', { ...rate, read: true }),
            notif('e_u2', { ...rate, userId: 'u2' })
        ];
        const devices = {
            u1: [device('u1', 'h1', { token: 'A', platform: 'android', on: true, lang: 'hi', kinds: {} }),
                device('u1', 'h2', { token: 'W', platform: 'web', on: true, lang: 'en', kinds: { item: false } }),
                device('u1', 'h3', { token: 'A', platform: 'android', on: true, lang: 'en', kinds: {} })],
            u2: [device('u2', 'h4', { token: 'X', platform: 'android', on: false, lang: 'en', kinds: {} })]
        };
        const sends = PushCore.planSends(docs, devices, P);
        expect(sends).toHaveLength(2);
        const android = sends[0].body.message;
        expect(android.notification).toEqual({ title: 'Bahi: 2 नई', body: 'नया आइटम जोड़ा गया: गेहूं — Ram' });
        expect(android.android.notification).toEqual({ channel_id: 'bahi', icon: 'ic_stat_bahi', color: '#89B284', tag: 'happa-bell' });
        expect(android.data).toEqual({ route: 'bell' });
        const web = sends[1].body.message;
        expect(web.notification).toBeUndefined();
        expect(web.data).toEqual({ route: 'bell', title: 'Bahi', body: 'Wheat: Retail rate ₹24.50 → ₹2,400 — Ram', tag: 'happa-bell' });
        expect(PushCore.planSends(docs, devices, 'bahi-happa-dev')[1].body.message.data.title).toBe('Bahi Dev');
    });

    test('FCM answers', () => {
        expect(PushCore.sendResult(200, '{}')).toBe('ok');
        expect(PushCore.sendResult(404, '')).toBe('stale');
        expect(PushCore.sendResult(400, JSON.stringify({ error: { details: [{ errorCode: 'INVALID_ARGUMENT' }], message: 'The registration token is not a valid FCM registration token' } }))).toBe('stale');
        expect(PushCore.sendResult(403, JSON.stringify({ error: { details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } }))).toBe('stale');
        expect(PushCore.sendResult(503, '')).toBe('retry');
        expect(PushCore.sendResult(401, '')).toBe('error');
    });

    test('only the two projects and plain event ids', () => {
        expect(PushCore.isProject('bahi-happa-dev')).toBe(true);
        expect(PushCore.isProject('aadhat-management')).toBe(false);
        expect(PushCore.isProject('toString')).toBe(false);
        expect(PushCore.isEventId('rate-abc-12_x')).toBe(true);
        expect(PushCore.isEventId('a/b')).toBe(false);
        expect(PushCore.isEventId('')).toBe(false);
    });

    test('sweep starts 2 minutes before the cursor, at most 2 days back', () => {
        const now = Date.parse('2026-11-23T10:00:00Z');
        expect(PushCore.sweepFrom('2026-11-23T09:50:00Z', now, 120000, 172800000)).toBe('2026-11-23T09:48:00.000Z');
        expect(PushCore.sweepFrom(null, now, 120000, 172800000)).toBe('2026-11-21T10:00:00.000Z');
        expect(PushCore.sweepFrom('2026-01-01T00:00:00Z', now, 120000, 172800000)).toBe('2026-11-21T10:00:00.000Z');
    });
});

describe('handleEvent with an injected fetch', () => {
    function fakeIo(routes) {
        const calls = [];
        return {
            calls,
            token: () => 'TOKEN',
            sleep: () => {},
            fetch: (r) => {
                calls.push(r);
                const hit = routes.find(([m, re]) => m === r.method && re.test(r.url));
                const out = hit ? hit[2](r) : { status: 200, text: '{}' };
                return { status: out.status, text: typeof out.text === 'string' ? out.text : JSON.stringify(out.text) };
            }
        };
    }

    test('reads the event, sends, deletes a stale token, marks the docs pushed', () => {
        const io = fakeIo([
            ['post', /:runQuery$/, () => ({ status: 200, text: [{ document: restDoc('notifications/e1_u1', { ...rate, eventKey: 'e1' }) }, { readTime: 'x' }] })],
            ['get', /users\/u1\/devices/, () => ({ status: 200, text: { documents: [
                restDoc('users/u1/devices/good', { token: 'G', platform: 'android', on: true, lang: 'en', kinds: {} }),
                restDoc('users/u1/devices/old', { token: 'OLD', platform: 'web', on: true, lang: 'en', kinds: {} })
            ] } })],
            ['post', /messages:send$/, (r) => (JSON.parse(r.payload).message.token === 'OLD'
                ? { status: 404, text: { error: { details: [{ errorCode: 'UNREGISTERED' }] } } }
                : { status: 200, text: { name: 'm1' } })],
            ['post', /:commit$/, () => ({ status: 200, text: {} })]
        ]);
        const r = PushCore.handleEvent(io, P, 'e1');
        expect(r).toEqual({ ok: true, docs: 1, targets: 2, sent: 1, stale: 1, failed: 0, limited: 0 });
        expect(io.calls.every(c => c.headers.Authorization === 'Bearer TOKEN' && c.headers['X-Goog-User-Project'] === P)).toBe(true);
        expect(JSON.parse(io.calls[0].payload).structuredQuery.where.fieldFilter.value).toEqual({ stringValue: 'e1' });
        expect(io.calls.find(c => c.method === 'delete').url).toBe(`https://firestore.googleapis.com/v1/${ROOT}/users/u1/devices/old`);
        const commit = JSON.parse(io.calls.find(c => /:commit$/.test(c.url)).payload);
        expect(commit.writes).toEqual([{
            update: { name: `${ROOT}/notifications/e1_u1`, fields: { pushed: { booleanValue: true } } },
            updateMask: { fieldPaths: ['pushed'] },
            currentDocument: { exists: true }
        }]);
    });

    test('already pushed: nothing sent, nothing written', () => {
        const io = fakeIo([
            ['post', /:runQuery$/, () => ({ status: 200, text: [{ document: restDoc('notifications/e1_u1', { ...rate, pushed: true }) }] })]
        ]);
        expect(PushCore.handleEvent(io, P, 'e1')).toEqual({ ok: true, docs: 0, targets: 0, sent: 0, stale: 0, failed: 0, limited: 0 });
        expect(io.calls).toHaveLength(1);
    });

    test('another project or a bad id: no call at all', () => {
        const io = fakeIo([]);
        expect(PushCore.handleEvent(io, 'aadhat-management', 'e1').ok).toBe(false);
        expect(PushCore.handleEvent(io, P, '../x').ok).toBe(false);
        expect(io.calls).toHaveLength(0);
    });

    test('a 503 is tried once more; sweep returns the newest timestamp', () => {
        let sends = 0;
        const io = fakeIo([
            ['post', /:runQuery$/, (r) => {
                expect(JSON.parse(r.payload).structuredQuery.where.fieldFilter.value).toEqual({ timestampValue: '2026-11-23T04:00:00Z' });
                return { status: 200, text: [
                    { document: { name: `${ROOT}/notifications/e1_u1`, fields: { ...fields(rate), timestamp: { timestampValue: '2026-11-23T05:00:00.123Z' } } } }
                ] };
            }],
            ['get', /devices/, () => ({ status: 200, text: { documents: [restDoc('users/u1/devices/d', { token: 'G', platform: 'android', on: true, lang: 'en', kinds: {} })] } })],
            ['post', /messages:send$/, () => (++sends === 1 ? { status: 503, text: '' } : { status: 200, text: {} })]
        ]);
        const r = PushCore.sweep(io, P, '2026-11-23T04:00:00Z');
        expect(r).toMatchObject({ ok: true, newest: '2026-11-23T05:00:00.123Z', docs: 1, sent: 1 });
        expect(sends).toBe(2);
    });
});

describe('test notifications (Settings › Notifications › Test)', () => {
    const test1 = { type: 'test', userId: 'u1', changedBy: 'Ram', changedByUserId: 'u9', eventKey: 'test-1', timestamp: '2026-11-24T10:00:00Z' };
    const dev = (kinds = {}) => device('u1', 'h1', { token: 'A', platform: 'android', on: true, lang: 'en', kinds });

    test('only the master switch counts; the message says it is a test', () => {
        expect(PushCore.wants({ on: true, token: 't', kinds: { bell: false, rate: false } }, 'test')).toBe(true);
        expect(PushCore.wants({ on: false, token: 't', kinds: {} }, 'test')).toBe(false);
        const [s] = PushCore.planSends([notif('test-1_u1', test1)], { u1: [dev({ bell: false })] }, P);
        expect(s.body.message.notification.body).toBe('Test notification: it reached this phone. — Ram');
        expect(s.body.message.data).toEqual({ route: 'bell', test: '1' });
        const [w] = PushCore.planSends([notif('test-1_u1', test1)], { u1: [device('u1', 'w', { token: 'W', platform: 'web', on: true, kinds: {} })] }, P);
        expect(w.body.message.data.test).toBe('1');
    });

    test('a sender over the limit: counted once per event, nothing sent, docs marked pushed', () => {
        const asked = [];
        const sends = [];
        const io = {
            token: () => 'T',
            allowTest: (uid, ev) => { asked.push([uid, ev]); return false; },
            fetch: (r) => {
                if (/messages:send$/.test(r.url)) sends.push(r);
                if (/:runQuery$/.test(r.url)) {
                    return { status: 200, text: JSON.stringify([
                        { document: restDoc('notifications/test-1_u1', test1) },
                        { document: restDoc('notifications/test-1_u2', { ...test1, userId: 'u2' }) }
                    ]) };
                }
                return { status: 200, text: '{}' };
            }
        };
        expect(PushCore.handleEvent(io, P, 'test-1')).toMatchObject({ ok: true, docs: 2, targets: 0, sent: 0, limited: 2 });
        expect(asked).toEqual([['u9', 'test-1']]);
        expect(sends).toHaveLength(0);
    });

    test('the sweep leaves a young test doc to its delayed call and keeps the cursor before it', () => {
        const now = Date.parse('2026-11-24T10:00:30Z');
        const io = {
            token: () => 'T',
            fetch: (r) => (/:runQuery$/.test(r.url)
                ? { status: 200, text: JSON.stringify([
                    { document: restDoc('notifications/test-1_u1', test1) },
                    { document: restDoc('notifications/r_u1', { ...rate, timestamp: '2026-11-24T10:00:20Z', pushed: true }) }
                ]) }
                : { status: 200, text: '{}' })
        };
        expect(PushCore.sweep(io, P, '2026-11-24T09:00:00Z', now)).toMatchObject({ newest: '2026-11-24T10:00:00Z', docs: 0 });
        expect(PushCore.sweep(io, P, '2026-11-24T09:00:00Z', now + PushCore.TEST_HOLD_MS)).toMatchObject({ newest: '2026-11-24T10:00:20Z', docs: 1 });
    });
});
