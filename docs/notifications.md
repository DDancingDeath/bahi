# Notifications (#12)

The bell (in-app inbox) plus **phone notifications** in the status bar. Stage 1 is free: no
server, no push service, no new account. Phone notifications are shown by the app itself (stage 2,
below, adds bell updates pushed to a closed app, also free):

- **Android app:** `@capacitor/local-notifications` 7.0.7 (Capacitor 7). A notification is shown
  at once (bell updates, the test) or **scheduled** with Android's alarm service, so it comes at its
  time even when the app is closed or the phone was restarted.
- **Browser / installed web app:** the service worker's `registration.showNotification()` (the only
  way that works in Chrome on Android; `new Notification()` is the fallback on a computer). A
  browser can't wake a closed site without push, so here everything needs the app open.

## What comes when

| | Android app: closed (swiped away, phone restarted) | Android app: in the background / screen off | Android app: on screen | Browser (phone or computer) |
|---|---|---|---|---|
| Bell update (rate / item changed, cash drawer opened / closed by someone else) | ✔ pushed (stage 2, once the owner set up the sender and the APK has the plugin; ≤ 5 min when the writer was offline) | ✔ (pushed; before stage 2: the app's own notification while Android keeps it running) | toast + bell badge only | system notification while the tab is hidden; toast + badge while it is visible; with a VAPID key also when no tab is open (the browser itself must be running on a computer) |
| To do reminder at its date and time (9:00 am without a time) | ✔ | ✔ | ✔ (status bar) | only while the app is open (a toast when it is on screen) |
| Udhaar summary (owner, managers) at the summary time | ✔ (amounts as of the last time the app was open) | ✔ | ✔ | only while open |
| Rent due on each rent due day (Rentals roles) | ✔ (needs the Rent page opened this month on this phone, like the rent reminder at the top of the Rent page; rent is not on Aadhat's Today) | ✔ | ✔ | only while open |
| Backup check (owner) 30 days after the last check on this phone | ✔ | ✔ | ✔ | only while open |
| Send test notification (Members) | one now + one 10 s later (close the app or lock the phone to try it) | ✔ | ✔ | one now |
| Test notifications panel (owner, managers): see [How to test](#how-to-test) | push test ✔ (~30 s) | ✔ | ✔ | ✔ (push test needs a VAPID key) |

Tapping a notification opens the app on the bell (bell updates; Today › Cash for a single cash opened / closed), Today's Reminders (To do),
Outstanding (Udhaar), Rentals › Rent, or Admin › Data (backup check). In the browser the service
worker focuses the open tab and tells it where to go, or opens `/?notify=<page>`.

**Never for your own changes:** a bell notification document is never written for the person who made
the change (`planNotificationDocs` leaves the actor out), so their other phones get nothing either; the
app also drops any arrival marked with their own uid. The one exception is a `test` from the test panel
to the sender's own phones. Notification text is what the bell already shows;
amounts appear only in the Udhaar summary (owner, managers) and Rent due (Rentals roles).

## Settings › Help & about › Notifications (every platform)

- **Phone notifications** (master switch, this phone only). The phone's permission (Android 13+
  POST_NOTIFICATIONS through the plugin's `requestPermissions`, or `Notification.requestPermission()`
  in a browser) is asked **only** when this is switched on or **Send test notification** is tapped,
  never at start (the old start-up request in `MainActivity` is gone). Refused: the switch stays off,
  a toast and the card say where to allow it (phone settings › Apps › this app › Notifications, or the
  browser's site settings). Unset, the switch is on in the Android app once the phone allows
  notifications, and in the browser only for those who had the old "Desktop notifications" on.
- **Updates from others** (per kind, on by default, work even with phone notifications off):
  **Rate changes** (everyone), **Item edits** (owner), **Cash opened** and **Cash closed** (owner and
  managers). Each switch decides the bell's toast and badge **and** the phone notification for that
  kind; a switched-off kind is still written and still listed in the inbox (marked read when the
  inbox opens), it just doesn't pop up, count or reach the status bar. Filtering happens on the
  recipient's phone, so no extra reads or writes. **Role changes always come** (they are about the
  person's own access). The old single "Bell updates" switch is gone; its stored `bell` value is
  ignored.
- **Reminders** (phone only, need the master switch): **To do reminders** (everyone, on by default),
  **Udhaar summary** (owner and managers, on), **Rent due** (Rentals roles, on), **Backup check**
  (owner, on). A kind someone can't see in the app is not offered.
- **Daily summary time** (default 9:30 am): Udhaar summary, Rent due and Backup check.
- Stored per phone in localStorage `happa.notify` (`{on, todo, udhaar, rent, backup, time, rate, item, cashOpen, cashClose}`;
  unset = on). The update kind keys are `UPDATE_KINDS` in `js/utils/notification-format.js`
  (`role` is listed there but always on).

## Scheduling (Android app)

Code: `js/modules/phone-notify.js` (plugin, browser, settings, taps), plan in
`js/utils/phone-reminders.js` (pure, tested).

- **Ids:** bell 1001 (each one replaces the last), test 2901 / 2902; reminders 2000–2899: Udhaar
  2001, Rent 2010–2014, Backup 2020, To do 2100–2149 (soonest first).
- **Rescheduling** happens when the app starts (after 8 s, once the data is in), when it goes to the
  background, when it comes back, on a change of To do reminders, of the rent / lease / pay
  reminders, of Outstanding / Today / History data, of the language and of any setting. Each time the
  plan is worked out from what the phone has; when it differs from the last one, **every pending id in
  2000–2899 is cancelled and the plan scheduled again** (one at a time), so a reminder that was done,
  cancelled or moved never fires. Sign-out cancels them all.
- **Data:** To do reminders come from Today's live listener (`reminders`, at most 50 open ones); with
  phone notifications on, it is started at sign-in too (up to 50 reads), not only when Today opens.
  Udhaar from the open bills already on the phone (BILL-DUE, OD-08: customers with a bill older than
  30 days count as overdue); rent from what Rentals last showed this month (REM-2, plus each lease's
  due day); the backup check from REM-3. Nothing extra is read for them.
- **Inexact alarms:** the app does not ask for SCHEDULE_EXACT_ALARM, so Android may deliver a reminder
  a few minutes late (more in deep battery saving); the plugin falls back to
  `setAndAllowWhileIdle`. Exact alarms need a special Play permission and are not needed for these.
- **Channels:** "Bahi" (bell updates, test) and "Reminders", both high importance; small icon
  `ic_stat_bahi` (the Bahi mark as a white silhouette, `res/drawable/ic_stat_bahi.xml`), colour from
  `capacitor.config.json`.
- **To do time:** reminders have an optional `dueTime` ('HH:MM', 24 h; firestore.rules checks it and
  the next copy of a repeating one keeps it).

Read state changes only when the inbox is opened (rows shown) or a row is
tapped — never because a toast or a phone notification was shown.

## Data

Collection `notifications` (`dev_notifications` on localhost), one doc per
recipient. Doc id = `<eventId>_<userId>`, so writing the same event again
never creates a second notification for anyone. Fields: `userId`, `type`,
`read`, `timestamp` (server), `eventKey`, plus per-type fields below.

Reads: one live listener on the 20 newest unread (`userId == me`,
`read == false`, `orderBy timestamp desc`) and inbox pages via
`read in [false, true]` — both served by the existing
`userId + read + timestamp` index. Older than 30 days: hidden, and deleted
(at most 100, once a day per device). Code: `js/modules/notifications.js`,
text/rules in `js/utils/notification-format.js`, writes in
`FirebaseService.sendNotification / notifyRateChanges / notifyItemEdit / notifyCash`.

## Catalogue

| type | sent when | recipients | status |
|---|---|---|---|
| `rate_change` | an item rate is changed (edit dialog or inline rate box; old value = value when editing started) | everyone except the person who changed it; wholesale rates: owners and managers only | live |
| `item_edit` (`action: added/updated`) | item added, or its name / Hindi name / contact changed | owners (except the person who changed it) | live |
| `cash_open` (`date`, `amount` = opening) | the day's cash is opened (Today › Cash; not when a phone joins an already open day) | owners and managers (except the person who opened it); any member may send it (rules: `cashNoteOk`) | live |
| `cash_close` (`date`, `amount` = counted, `difference`) | the day's cash is closed with a count; short / extra shown when not zero. Auto-closed past days don't notify | owners and managers (except the person who closed it) | live |
| `test` (only `changedBy`) | Settings › Notifications › Test notifications (owner, managers): the push test or "Other phones" | the chosen team members, or the sender (push test); rules: `testNoteOk`. Needs only the master switch, no per-kind switch | live |
| `edit` (`documentType`) | a bill / sale / payment was edited | owners | text supported; no sender wired yet |
| `review_flag` | an open review-queue flag | owners/managers | planned |
| `stale_outbox` | writes not synced for a long time on a device | that user + owners | planned |
| `print_failure` | a bill failed to print | that user | planned |
| `backup_failure` | nightly backup failed | owners | planned |
| `shop_reminder` | shop reminders (#56) | as configured | planned |

New types only need a sender: unknown types are shown with their `message` /
`messageHi` fields. Use a stable `eventId` per flag/event so it notifies at
most once. User-facing text is always English + Hindi.

## Stage 2: push while the app is closed (built)

Bell updates reach a phone whose app is closed (swiped away, phone restarted) or a browser with no
Bahi tab open. Still ₹0: no card, no Cloud Functions (they need the Blaze plan), no new account.

- **Sender:** a **Google Apps Script** project under the shop's Google account (aadhat2025@gmail.com,
  Owner of `bahi-happa` and `bahi-happa-dev`), code in [`push-sender/`](../push-sender/). It runs as
  that account: `ScriptApp.getOAuthToken()` (scopes `datastore`, `firebase.messaging`,
  `script.external_request`) reads Firestore over REST and sends with **FCM HTTP v1**. Requests made
  this way are authorised by IAM (the project Owner), not by `firestore.rules`. Each request names
  its project with `X-Goog-User-Project`, so one script serves both projects.
  - **Web app** `doPost({eventId, project, delay?})`: the phone that wrote an event's notification docs posts
    its event id right after the write (`firebase/push-trigger.js`, `no-cors`, fire and forget: the
    action never waits; no URL configured = nothing). Only `bahi-happa` and `bahi-happa-dev` are
    accepted. It reads that event's docs (`eventKey ==`), sends, marks each doc `pushed: true`, so a
    repeated call, or anyone posting a made-up id, sends nothing new; the same event id is ignored for
    10 minutes and at most 60 calls a minute are served. It answers `{ok, docs, targets, sent, stale,
    failed, limited}` (`targets`: devices it sent to, `sent`: accepted by FCM). `delay` (seconds, at most
    60, at most 10 such calls a minute) makes it wait first: the closed-app test. `test` docs: at most 5
    test events a minute per sender (CacheService); over that they are marked pushed unsent (`limited`).
  - **Time trigger** `sweep()` every 5 minutes: per project the docs written since the last sweep
    (cursor in Script Properties, 2 minutes overlap, at most 2 days back) that are not `pushed`, i.e.
    from a phone that was offline or closed before it could call. A `test` doc younger than 90 s is left
    to its (possibly delayed) call and the cursor stays before it. Usually one empty query (1 read) per
    project per run; about 290 runs a day, a second or two each, far inside the 90 minutes a day of
    trigger time.
  - **Who gets what:** the doc's `userId` (the writer is never a recipient). For each of that person's
    devices (`users/{uid}/devices`): only with Phone notifications on and that kind's own switch under
    "Updates from others" not off (`kinds`, a copy of `happa.notify`; `rate_change` → `rate`, `item_edit` → `item`,
    `role_change` → `role` (always on), `cash_open` → `cashOpen`, `cash_close` → `cashClose`; any
    other type always goes; `test` needs only Phone notifications on). Several new ones for a phone go as one ("Bahi: 3 new").
  - **Text:** the bell's own words in the phone's language (`push-sender/Core.js` `describe`, checked
    against `describeNotification` by `tests/push-sender/core.test.js`), then "— who".
  - **Stale tokens:** FCM 404 / `UNREGISTERED` / `SENDER_ID_MISMATCH` / an invalid token → the device doc
    is deleted. A 429 / 5xx is tried once more.
- **Android:** `@capacitor-firebase/messaging` 7.5.0 (the other `@capacitor-firebase` plugins are 7.5.0
  too) with the APK's `google-services.json`. The message is an FCM *notification* message on channel
  `bahi`, icon `ic_stat_bahi`, colour `#89B284`, tag `happa-bell` (a new one replaces the last), so
  Android shows it itself with the app swiped away or after a restart. The manifest names `bahi` and
  `ic_stat_bahi` as defaults too. With the app on screen Android shows nothing (toast + badge as
  before). A tap opens the bell (`notificationActionPerformed`, also on a cold start). Once this phone
  has a device doc, the app no longer shows its own bell notification 1001 in the background: the push
  does, so one change never gives two.
- **Browser:** the Firebase messaging SDK (`vendor/firebase/10.7.1/firebase-messaging-compat.js`, loaded
  only when the project has a VAPID key) subscribes **our** service worker; the message is data only
  and the service worker's `push` handler shows it (tag `happa-bell`, so it merges with the app's own
  bell notification) unless a Bahi tab is on screen. A tap goes through `notificationclick` as before.
- **Device doc** `users/{uid}/devices/{sha256(token) first 40 hex}`: `token`, `platform` (`android` |
  `web`), `on`, `kinds`, `lang` (`en` | `hi`), `updatedAt` (server). Written at sign-in, when a switch
  or the language changes, and at least once a week (`happa.pushDevice` remembers the last write);
  deleted when Phone notifications is switched off and before sign-out (with the token, so a shared
  phone gets nothing for the last person). Rules: only that person, only these fields (`pushDeviceOk`).
  Clients can never set `pushed` on a notification (rules tests).
- **Config:** `pushUrl` in `happa.config.json` (the web app's `/exec` URL, the same for both projects)
  and `firebase.vapidKey` per project (`happa.config.json` for bahi-happa,
  `config/targets/bahi-happa-dev.json`). Empty = that part is off; `npm run apply:happa-config` copies
  them into `APP_IDENTITY.push`.
- **Cost:** ₹0 (Apps Script and FCM are free; a few hundred Firestore reads a day).

### Owner setup (once)

Until steps 1–2 are done nothing changes for anyone: no URL, no registration, the old local bell
notification as before.

**Status (24 Nov 2026):** done. The sender is the standalone script "Bahi push sender" under
aadhat2025 (script id `1SWkDVGNSnay9Hn8C3QhlSadTGuXoFLl4Ng7nUVZN4rOebBl7NWK_1I43`, pushed with clasp),
web app deployment `AKfycbyFJF7n7nCqhA7r4tGMoWpNDlavuHzWf55ye8qmBP7rtu7QOz7R-bmo4le0vMl_Dfs-rw`
(version 1), which is the `pushUrl`. The URL is bundled into the APK at build time, so Android phones
register only with an APK built after it was set (rc18 has the plugin but an empty URL).

1. **Apps Script** (signed in to Chrome as **aadhat2025@gmail.com**, the Owner of both projects):
   1. Turn on <https://script.google.com/home/usersettings> › Google Apps Script API.
   2. New project "Bahi push". Project settings › tick "Show appsscript.json". Paste
      `push-sender/appsscript.json`, `Core.js` and `Main.js` from the repo (or let CI push them, step 3).
   3. Run `checkAccess` once: allow the scopes (Google shows "unverified app": Advanced › Go to Bahi
      push). The log must say `Firestore 200` for both projects.
   4. Run `installTrigger` once (the 5-minute sweep; Triggers shows it).
   5. Deploy › New deployment › Web app: Execute as **Me**, Who has access **Anyone**. Copy the web app
      URL (`https://script.google.com/macros/s/…/exec`) and the deployment id.
2. **URL into the app:** send us the URL (it goes into `pushUrl`, one PR, auto-deployed); the Android
   app needs the next APK (rc) with the messaging plugin.
3. **CI deploys of the script (optional):** on this PC `npm i -g @google/clasp@2.4.2`, `clasp login` as
   aadhat2025, then add GitHub secrets `CLASPRC_JSON` (the content of `~/.clasprc.json`),
   `PUSH_SENDER_SCRIPT_ID` (Project settings › Script ID) and `PUSH_SENDER_DEPLOYMENT_ID`.
   `push-sender-deploy.yml` then pushes and redeploys the same web app on every change to
   `push-sender/`; without the secrets it skips with a notice.
4. **Browser push (optional):** Firebase console › each project › Project settings › Cloud Messaging
   › Web Push certificates › Generate key pair; send us the public key (it goes into
   `firebase.vapidKey`). Android does not need it.

If a call says "API has not been used in project …": in the script's Project settings › Google Cloud
project, switch it to the project number of `bahi-happa` (that also needs the OAuth consent screen
there, "In production").

## How to test

Settings › Help & about › Notifications › **Test notifications** (owner and managers; Members keep the
single "Send test notification"). Each button shows its result under it; at most 5 tests a minute per
person (this phone, and the push sender counts too).

| Button | What it does | When it should come |
|---|---|---|
| **This phone, now** | a local notification (the plugin / service worker) | at once |
| **This phone, in 15 s** | a local one scheduled with Android's alarm service (browser: a timer). Press Home after tapping | 15 s, app in the background |
| **This phone by push, in about 30 s** | writes a `test` doc for yourself and asks the sender with `delay: 30`; then swipe the app away. A real FCM push to every phone of yours with Phone notifications on. Not shown as a toast on the phone that sent it | ~30 s; if the call is lost, the 5-minute sweep (≤ 5 min) |
| **Other phones** (a person or "Everyone on the team", you left out) | a `test` doc in each person's bell: a toast if their app is open, the app's own notification in the background, a push when closed. The line shows phones targeted and accepted (FCM 200) | at once |

**Status of this phone:** push registered (the device doc, with when it was last written; one read, at
most once a minute or with "Check again"), the Phone notifications switch, the permission, the last push
the app saw (on screen or tapped; in the browser also the service worker's), and on Android the battery
hint (Apps › Bahi › Battery › Unrestricted). A test push that arrives with the app on screen shows a
toast ("Test push arrived while the app was open"), since Android shows nothing then.

What a failure means: "not registered for push" = no device doc (switch Phone notifications off and on,
or the APK is older than rc19); "0 phones targeted" = the person's phones have no device doc or Phone
notifications off; targeted but not accepted = FCM refused (a stale token is deleted, see the sender's
log); accepted but nothing on the phone = the phone (battery saving, the app's notification settings).
