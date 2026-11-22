/**
 * Bahi push sender, the Apps Script part (docs/notifications.md, "Stage 2"). Runs as the account that
 * owns the Firebase projects: its OAuth token reads Firestore over REST and sends through FCM v1.
 * Web app: doPost({eventId, project}) from the phone that wrote the notifications. Trigger: sweep()
 * every 5 minutes for docs no call reported (offline writers).
 */

var SWEEP_OVERLAP_MS = 2 * 60 * 1000;
var SWEEP_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
var EVENT_SEEN_S = 600;
var CALLS_PER_MINUTE = 60;

function pushIo_() {
    return {
        token: function () { return ScriptApp.getOAuthToken(); },
        fetch: function (r) {
            var res = UrlFetchApp.fetch(r.url, {
                method: r.method,
                headers: r.headers,
                contentType: r.contentType,
                payload: r.payload,
                muteHttpExceptions: true
            });
            return { status: res.getResponseCode(), text: res.getContentText() };
        },
        sleep: function (ms) { Utilities.sleep(ms); },
        log: function (msg) { console.warn(msg); }
    };
}

function json_(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {}; } catch (_) { body = {}; }
    var project = body.project;
    var eventId = body.eventId;
    if (!PushCore.isProject(project) || !PushCore.isEventId(eventId)) return json_({ ok: false, error: 'bad request' });

    var cache = CacheService.getScriptCache();
    var key = 'ev:' + project + ':' + eventId;
    if (cache.get(key)) return json_({ ok: true, repeat: true });
    cache.put(key, '1', EVENT_SEEN_S);
    var minute = 'calls:' + Math.floor(Date.now() / 60000);
    var calls = Number(cache.get(minute) || 0) + 1;
    cache.put(minute, String(calls), 120);
    if (calls > CALLS_PER_MINUTE) return json_({ ok: false, error: 'busy' });

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy' });
    try {
        return json_(PushCore.handleEvent(pushIo_(), project, eventId));
    } catch (err) {
        console.error('doPost ' + project + ' ' + eventId + ': ' + err);
        return json_({ ok: false, error: 'failed' });
    } finally {
        lock.releaseLock();
    }
}

function doGet() {
    return json_({ ok: true, app: 'bahi-push' });
}

/** Time trigger: what no call reported, per project, from where the last sweep stopped. */
function sweep() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return;
    var props = PropertiesService.getScriptProperties();
    try {
        Object.keys(PushCore.PROJECTS).forEach(function (project) {
            var cursorKey = 'cursor:' + project;
            var since = PushCore.sweepFrom(props.getProperty(cursorKey), Date.now(), SWEEP_OVERLAP_MS, SWEEP_MAX_AGE_MS);
            try {
                var r = PushCore.sweep(pushIo_(), project, since);
                if (r.newest) props.setProperty(cursorKey, r.newest);
                if (r.docs) console.log('sweep ' + project + ': ' + JSON.stringify(r));
            } catch (err) {
                console.error('sweep ' + project + ': ' + err);
            }
        });
    } finally {
        lock.releaseLock();
    }
}

/** Run once by hand (or by CI): one sweep trigger every 5 minutes. */
function installTrigger() {
    ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'sweep') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('sweep').timeBased().everyMinutes(5).create();
}

/** Run once by hand after deploying: checks that this account can read both projects. */
function checkAccess() {
    var io = pushIo_();
    Object.keys(PushCore.PROJECTS).forEach(function (project) {
        var r = io.fetch({
            url: 'https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents/settings/app',
            method: 'get',
            headers: { Authorization: 'Bearer ' + io.token(), 'X-Goog-User-Project': project }
        });
        console.log(project + ': Firestore ' + r.status + (r.status === 200 ? ' ok' : ' ' + r.text.slice(0, 300)));
    });
}
