/**
 * Bahi push sender, the pure part (docs/notifications.md, "Stage 2"). Runs in Google Apps Script
 * (V8) and in Node (tests). No I/O of its own: every call to Firestore or FCM goes through
 * `io.fetch({url, method, headers, payload}) -> {status, text}` and `io.token()`.
 */
var PushCore = (function () {
    'use strict';

    var PROJECTS = { 'bahi-happa': 'Bahi', 'bahi-happa-dev': 'Bahi Dev' };
    var FS = 'https://firestore.googleapis.com/v1';
    var FCM = 'https://fcm.googleapis.com/v1';
    var EVENT_RE = /^[\w-]{1,120}$/;
    var UID_RE = /^[\w-]{1,128}$/;
    var MAX_DOCS = 200;
    var CHANNEL = 'bahi';
    var ICON = 'ic_stat_bahi';
    var COLOR = '#89B284';
    var TAG = 'happa-bell';
    var TEST = 'test';
    /** A test doc this young waits for its own (possibly delayed) web app call instead of the sweep. */
    var TEST_HOLD_MS = 90 * 1000;

    /** The person's switch for each notification type (`happa.notify`, notification-format.js TYPE_KINDS); others always go. */
    var KIND_OF_TYPE = {
        rate_change: 'rate',
        item_edit: 'item',
        role_change: 'role',
        cash_open: 'cashOpen',
        cash_close: 'cashClose'
    };

    var RATE_LABELS = {
        purchase: { en: 'Purchase', hi: 'खरीद' },
        sale: { en: 'Retail', hi: 'फुटकर' },
        retail: { en: 'Retail', hi: 'फुटकर' },
        wholesale: { en: 'Wholesale', hi: 'थोक' }
    };
    var DOC_LABELS = {
        bill: 'purchase', purchase: 'purchase', purchases: 'purchase',
        sale: 'wholesale', wholesale: 'wholesale', wholesaleSale: 'wholesale', wholesaleSales: 'wholesale',
        retail: 'retail', retailSale: 'retail', retailSales: 'retail',
        payment: 'payment', expense: 'expense', item: 'item'
    };
    var DOC_TEXT = {
        purchase: { en: 'Purchase bill', hi: 'खरीद बिल' },
        wholesale: { en: 'Wholesale sale', hi: 'थोक बिक्री' },
        retail: { en: 'Retail sale', hi: 'फुटकर बिक्री' },
        payment: { en: 'Payment', hi: 'भुगतान' },
        expense: { en: 'Expense', hi: 'खर्च' },
        item: { en: 'Item', hi: 'आइटम' }
    };
    var ROLE_LABELS = { owner: { en: 'Owner', hi: 'मालिक' }, manager: { en: 'Manager', hi: 'मैनेजर' } };
    var MEMBER = { en: 'Member', hi: 'सदस्य' };
    var FIELD_LABELS = {
        name: { en: 'name', hi: 'नाम' },
        hindiName: { en: 'Hindi name', hi: 'हिंदी नाम' },
        contactPerson: { en: 'contact', hi: 'संपर्क' }
    };

    function isProject(p) { return typeof p === 'string' && Object.prototype.hasOwnProperty.call(PROJECTS, p); }
    function isEventId(id) { return typeof id === 'string' && EVENT_RE.test(id); }
    function appName(project) { return PROJECTS[project] || 'Bahi'; }

    // ---------- Firestore REST values ----------

    function decodeValue(v) {
        if (!v || typeof v !== 'object') return null;
        if ('stringValue' in v) return v.stringValue;
        if ('booleanValue' in v) return v.booleanValue;
        if ('integerValue' in v) return Number(v.integerValue);
        if ('doubleValue' in v) return Number(v.doubleValue);
        if ('timestampValue' in v) return v.timestampValue;
        if ('nullValue' in v) return null;
        if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decodeValue);
        if ('mapValue' in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
        return null;
    }

    function decodeFields(fields) {
        var out = {};
        Object.keys(fields || {}).forEach(function (k) { out[k] = decodeValue(fields[k]); });
        return out;
    }

    /** {name, id, data} from a REST document. */
    function decodeDoc(doc) {
        var name = String((doc && doc.name) || '');
        return { name: name, id: name.slice(name.lastIndexOf('/') + 1), data: decodeFields(doc && doc.fields) };
    }

    // ---------- text (the same words as the bell, utils/notification-format.js) ----------

    function clean(v) { return typeof v === 'string' ? v.trim() : ''; }

    function groupIndian(intText) {
        if (intText.length <= 3) return intText;
        var rest = intText.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
        return rest + ',' + intText.slice(-3);
    }

    /** ₹ text of a rate (MONEY-TEXT, preset `rate`): paise only when there are any. */
    function rupees(value) {
        var n = Number(value);
        if (!isFinite(n)) return '—';
        var paise = Math.round(Math.abs(n) * 100);
        var frac = paise % 100;
        var text = groupIndian(String(Math.floor(paise / 100))) + (frac ? '.' + (frac < 10 ? '0' : '') + frac : '');
        return (n < 0 ? '-' : '') + '₹' + text;
    }

    function rateText(value) {
        if (Array.isArray(value)) return value.length ? value.map(rupees).join(', ') : '—';
        if (value === '' || value === null || value === undefined) return '—';
        return rupees(value);
    }

    function itemNames(n) {
        var en = clean(n.itemName) || clean(n.itemHindiName) || 'Item';
        return { en: en, hi: clean(n.itemHindiName) || en };
    }

    function either(a, b) { return a !== undefined && a !== null ? a : b; }

    /** {en, hi, who} for one notification doc. */
    function describe(n) {
        n = n || {};
        var who = clean(n.changedBy) || clean(n.editedBy) || clean(n.createdByName) || clean(n.byName);
        var type = n.type || '';
        var names;
        if (type === 'rate_change') {
            names = itemNames(n);
            var label = RATE_LABELS[n.rateType] || { en: clean(n.rateTypeLabel) || 'Rate', hi: clean(n.rateTypeLabel) || 'रेट' };
            var change = rateText(either(n.oldRate, n.oldRates)) + ' → ' + rateText(either(n.newRate, n.newRates));
            return { en: names.en + ': ' + label.en + ' rate ' + change, hi: names.hi + ': ' + label.hi + ' रेट ' + change, who: who };
        }
        if (type === 'item_edit') {
            names = itemNames(n);
            if (n.action === 'added') return { en: 'New item added: ' + names.en, hi: 'नया आइटम जोड़ा गया: ' + names.hi, who: who };
            var fields = (Array.isArray(n.fields) ? n.fields : []).filter(function (f) { return FIELD_LABELS[f]; });
            var enF = fields.length ? ' (' + fields.map(function (f) { return FIELD_LABELS[f].en; }).join(', ') + ')' : '';
            var hiF = fields.length ? ' (' + fields.map(function (f) { return FIELD_LABELS[f].hi; }).join(', ') + ')' : '';
            return { en: 'Item updated: ' + names.en + enF, hi: 'आइटम बदला गया: ' + names.hi + hiF, who: who };
        }
        if (type === 'role_change') {
            var role = ROLE_LABELS[n.newRole] || MEMBER;
            return {
                en: (who || 'An owner') + ' changed your role to ' + role.en,
                hi: (who || 'एक मालिक') + ' ने आपकी भूमिका बदलकर ' + role.hi + ' कर दी',
                who: ''
            };
        }
        if (type === 'cash_open' || type === 'cash_close') {
            var name = who || 'Someone';
            var hiName = who || 'किसी';
            var amount = rupees(Number(n.amount) || 0);
            if (type === 'cash_open') {
                return { en: 'Cash opened by ' + name + ' · ' + amount + ' opening', hi: hiName + ' ने नकद खोला · ' + amount + ' शुरुआती', who: '' };
            }
            var diff = Math.round((Number(n.difference) || 0) * 100) / 100;
            var off = diff ? rupees(Math.abs(diff)) : '';
            return {
                en: 'Cash closed by ' + name + ' · counted ' + amount + (off ? ' · ' + (diff < 0 ? 'short' : 'extra') + ' ' + off : ''),
                hi: hiName + ' ने नकद बंद किया · गिना ' + amount + (off ? ' · ' + off + ' ' + (diff < 0 ? 'कम' : 'ज़्यादा') : ''),
                who: ''
            };
        }
        if (type === TEST) {
            return { en: 'Test notification: it reached this phone.', hi: 'जाँच की सूचना: इस फ़ोन तक पहुँच गई।', who: who };
        }
        if (type === 'edit') {
            var doc = DOC_TEXT[DOC_LABELS[n.documentType]] || { en: 'Record', hi: 'रिकॉर्ड' };
            var ref = clean(n.billNumber) || clean(n.newData && n.newData.billNumber) || clean(n.oldData && n.oldData.billNumber);
            var suffix = ref ? ' ' + ref : '';
            return { en: doc.en + suffix + ' edited', hi: doc.hi + suffix + ' बदला गया', who: who };
        }
        return {
            en: clean(n.message) || clean(n.title) || 'New update',
            hi: clean(n.messageHi) || clean(n.titleHi) || 'नई सूचना',
            who: who
        };
    }

    /** The status-bar line: the bell's text in the device's language, then who did it. */
    function pushText(n, lang) {
        var d = describe(n);
        return (lang === 'hi' ? d.hi : d.en) + (d.who ? ' — ' + d.who : '');
    }

    // ---------- who gets what ----------

    function kindOf(type) { return KIND_OF_TYPE[type] || 'bell'; }

    /** A device doc wants this type: phone notifications on, bell updates on, its own switch not off (a test needs only the first). */
    function wants(device, type) {
        if (!device || device.on !== true || typeof device.token !== 'string' || !device.token) return false;
        if (type === TEST) return true;
        var kinds = device.kinds && typeof device.kinds === 'object' ? device.kinds : {};
        if (kinds.bell === false) return false;
        var k = kindOf(type);
        return k === 'bell' || kinds[k] !== false;
    }

    function timeOf(n) {
        var t = Date.parse((n && n.timestamp) || '');
        return isFinite(t) ? t : 0;
    }

    /** Notifications not pushed (or read) yet, once each, with a recipient. */
    function pending(docs) {
        var seen = {};
        return (docs || []).filter(function (d) {
            if (!d || !d.data || d.data.pushed === true || d.data.read === true) return false;
            if (typeof d.data.userId !== 'string' || !UID_RE.test(d.data.userId) || seen[d.name]) return false;
            seen[d.name] = true;
            return true;
        });
    }

    /** FCM v1 message. Android: shown by the system on the "Bahi" channel, app closed or not. Web: data only; the service worker shows it. */
    function buildMessage(device, title, body, test) {
        var data = test ? { route: 'bell', test: '1' } : { route: 'bell' };
        if (device.platform === 'web') {
            var web = { route: 'bell', title: title, body: body, tag: TAG };
            if (test) web.test = '1';
            return {
                message: {
                    token: device.token,
                    data: web,
                    webpush: { headers: { Urgency: 'high', TTL: '86400' } }
                }
            };
        }
        return {
            message: {
                token: device.token,
                notification: { title: title, body: body },
                data: data,
                android: {
                    priority: 'HIGH',
                    ttl: '86400s',
                    notification: { channel_id: CHANNEL, icon: ICON, color: COLOR, tag: TAG }
                }
            }
        };
    }

    /**
     * One message per device: the newest wanted notification's text; the title says "Bahi: 3 new" for several.
     * @returns {Array<{uid: string, device: Object, body: Object, docNames: string[]}>}
     */
    function planSends(docs, devicesByUid, project) {
        var name = appName(project);
        var out = [];
        var byUid = {};
        pending(docs).forEach(function (d) { (byUid[d.data.userId] = byUid[d.data.userId] || []).push(d); });
        Object.keys(byUid).forEach(function (uid) {
            var list = byUid[uid].slice().sort(function (a, b) { return timeOf(b.data) - timeOf(a.data); });
            var tokens = {};
            (devicesByUid[uid] || []).forEach(function (dev) {
                var data = (dev && dev.data) || {};
                if (tokens[data.token]) return;
                var mine = list.filter(function (d) { return wants(data, d.data.type); });
                if (!mine.length) return;
                tokens[data.token] = true;
                var lang = data.lang === 'hi' ? 'hi' : 'en';
                var title = mine.length > 1 ? name + ': ' + mine.length + (lang === 'hi' ? ' नई' : ' new') : name;
                out.push({
                    uid: uid,
                    device: dev,
                    body: buildMessage({ token: data.token, platform: data.platform }, title, pushText(mine[0].data, lang), mine[0].data.type === TEST),
                    docNames: mine.map(function (d) { return d.name; })
                });
            });
        });
        return out;
    }

    /** 'ok' | 'stale' (delete the device doc) | 'retry' | 'error', from FCM's answer. */
    function sendResult(status, text) {
        if (status >= 200 && status < 300) return 'ok';
        if (status === 404) return 'stale';
        var code = '';
        try {
            var err = JSON.parse(text || '{}').error || {};
            (err.details || []).forEach(function (x) { if (x && x.errorCode) code = x.errorCode; });
        } catch (_) { code = ''; }
        if (code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') return 'stale';
        if (status === 400 && /registration token/i.test(text || '')) return 'stale';
        if (status === 429 || status >= 500) return 'retry';
        return 'error';
    }

    // ---------- REST requests ----------

    function docsRoot(project) { return FS + '/projects/' + project + '/databases/(default)/documents'; }

    function req(io, project, method, url, payload) {
        var r = {
            url: url,
            method: method,
            headers: { Authorization: 'Bearer ' + io.token(), 'X-Goog-User-Project': project },
            contentType: 'application/json'
        };
        if (payload !== undefined) r.payload = JSON.stringify(payload);
        return io.fetch(r);
    }

    function eventQuery(eventId) {
        return {
            structuredQuery: {
                from: [{ collectionId: 'notifications' }],
                where: { fieldFilter: { field: { fieldPath: 'eventKey' }, op: 'EQUAL', value: { stringValue: eventId } } },
                limit: MAX_DOCS
            }
        };
    }

    function sinceQuery(sinceIso) {
        return {
            structuredQuery: {
                from: [{ collectionId: 'notifications' }],
                where: { fieldFilter: { field: { fieldPath: 'timestamp' }, op: 'GREATER_THAN', value: { timestampValue: sinceIso } } },
                orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'ASCENDING' }],
                limit: MAX_DOCS
            }
        };
    }

    function runQuery(io, project, query) {
        var r = req(io, project, 'post', docsRoot(project) + ':runQuery', query);
        if (r.status !== 200) throw new Error('runQuery ' + r.status + ': ' + String(r.text).slice(0, 300));
        return (JSON.parse(r.text || '[]') || []).filter(function (x) { return x && x.document; })
            .map(function (x) { return decodeDoc(x.document); });
    }

    function listDevices(io, project, uid) {
        var r = req(io, project, 'get', docsRoot(project) + '/users/' + uid + '/devices?pageSize=20');
        if (r.status === 404) return [];
        if (r.status !== 200) throw new Error('devices ' + r.status);
        return ((JSON.parse(r.text || '{}') || {}).documents || []).map(decodeDoc);
    }

    function pushedWrites(names) {
        return {
            writes: names.map(function (name) {
                return {
                    update: { name: name, fields: { pushed: { booleanValue: true } } },
                    updateMask: { fieldPaths: ['pushed'] },
                    currentDocument: { exists: true }
                };
            })
        };
    }

    function markPushed(io, project, names) {
        if (!names.length) return;
        var r = req(io, project, 'post', docsRoot(project) + ':commit', pushedWrites(names));
        if (r.status === 200) return;
        names.forEach(function (name) {
            req(io, project, 'patch', FS + '/' + name + '?updateMask.fieldPaths=pushed&currentDocument.exists=true',
                { fields: { pushed: { booleanValue: true } } });
        });
    }

    /**
     * Test docs whose sender is over the test limit (`io.allowTest(uid, eventKey)`, counted once per event).
     * @returns {Object<string, boolean>} doc name → true
     */
    function limitedTests(io, docs) {
        var out = {};
        var asked = {};
        if (!io.allowTest) return out;
        docs.forEach(function (d) {
            if (d.data.type !== TEST) return;
            var key = String(d.data.changedByUserId || '') + ' ' + String(d.data.eventKey || '');
            if (!(key in asked)) asked[key] = io.allowTest(String(d.data.changedByUserId || ''), String(d.data.eventKey || '')) !== false;
            if (!asked[key]) out[d.name] = true;
        });
        return out;
    }

    /**
     * Sends the pending docs to their recipients' devices, deletes stale tokens and marks the docs
     * `pushed: true`, so a second call or the sweep never sends them again.
     * @returns {{docs: number, targets: number, sent: number, stale: number, failed: number, limited: number}}
     */
    function pushDocs(io, project, docs) {
        var todo = pending(docs);
        var stats = { docs: todo.length, targets: 0, sent: 0, stale: 0, failed: 0, limited: 0 };
        if (!todo.length) return stats;
        var limited = limitedTests(io, todo);
        var sendable = todo.filter(function (d) { return !limited[d.name]; });
        stats.limited = todo.length - sendable.length;
        var devices = {};
        sendable.forEach(function (d) {
            var uid = d.data.userId;
            if (devices[uid]) return;
            try { devices[uid] = listDevices(io, project, uid); } catch (e) { devices[uid] = []; stats.failed++; }
        });
        var url = FCM + '/projects/' + project + '/messages:send';
        var sends = planSends(sendable, devices, project);
        stats.targets = sends.length;
        sends.forEach(function (s) {
            var r = req(io, project, 'post', url, s.body);
            var result = sendResult(r.status, r.text);
            if (result === 'retry') {
                if (io.sleep) io.sleep(1000);
                r = req(io, project, 'post', url, s.body);
                result = sendResult(r.status, r.text);
            }
            if (result === 'ok') stats.sent++;
            else if (result === 'stale') {
                stats.stale++;
                req(io, project, 'delete', FS + '/' + s.device.name);
            } else {
                stats.failed++;
                if (io.log) io.log('FCM ' + r.status + ' ' + String(r.text).slice(0, 200));
            }
        });
        markPushed(io, project, todo.map(function (d) { return d.name; }));
        return stats;
    }

    /** The web app's call: the docs of one event, from the phone that wrote them. */
    function handleEvent(io, project, eventId) {
        if (!isProject(project) || !isEventId(eventId)) return { ok: false, error: 'bad request' };
        var stats = pushDocs(io, project, runQuery(io, project, eventQuery(eventId)));
        return {
            ok: true, docs: stats.docs, targets: stats.targets, sent: stats.sent, stale: stats.stale,
            failed: stats.failed, limited: stats.limited
        };
    }

    /**
     * The time trigger: docs written after `sinceIso` (offline writers, missed calls). With `nowMs`, test
     * docs younger than TEST_HOLD_MS are left to their web app call and the cursor stays before them.
     */
    function sweep(io, project, sinceIso, nowMs) {
        if (!isProject(project)) return { ok: false, newest: null, docs: 0, sent: 0, stale: 0, failed: 0 };
        var docs = runQuery(io, project, sinceQuery(sinceIso));
        var newest = null;
        var held = null;
        docs = docs.filter(function (d) {
            var t = d.data.timestamp;
            if (nowMs && d.data.type === TEST && nowMs - Date.parse(t || '') < TEST_HOLD_MS) {
                if (!held || Date.parse(t) < Date.parse(held)) held = t;
                return false;
            }
            if (t && (!newest || Date.parse(t) > Date.parse(newest))) newest = t;
            return true;
        });
        if (held && (!newest || Date.parse(held) < Date.parse(newest))) newest = held;
        var stats = pushDocs(io, project, docs);
        return { ok: true, newest: newest, docs: stats.docs, sent: stats.sent, stale: stats.stale, failed: stats.failed };
    }

    /** Where the next sweep starts: a little before the newest doc seen, never more than `maxAgeMs` back. */
    function sweepFrom(cursorIso, nowMs, overlapMs, maxAgeMs) {
        var floor = nowMs - maxAgeMs;
        var c = Date.parse(cursorIso || '');
        return new Date(isFinite(c) ? Math.max(floor, c - overlapMs) : floor).toISOString();
    }

    return {
        PROJECTS: PROJECTS,
        KIND_OF_TYPE: KIND_OF_TYPE,
        TEST_HOLD_MS: TEST_HOLD_MS,
        isProject: isProject,
        isEventId: isEventId,
        appName: appName,
        decodeValue: decodeValue,
        decodeDoc: decodeDoc,
        describe: describe,
        pushText: pushText,
        rupees: rupees,
        kindOf: kindOf,
        wants: wants,
        pending: pending,
        buildMessage: buildMessage,
        planSends: planSends,
        sendResult: sendResult,
        eventQuery: eventQuery,
        sinceQuery: sinceQuery,
        pushedWrites: pushedWrites,
        pushDocs: pushDocs,
        handleEvent: handleEvent,
        sweep: sweep,
        sweepFrom: sweepFrom
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PushCore;
