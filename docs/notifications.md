# Notifications (#12)

The bell (in-app inbox) plus **phone notifications** in the status bar. Stage 1 is free: no
server, no push service, no new account. Phone notifications are shown by the app itself:

- **Android app:** `@capacitor/local-notifications` 7.0.7 (Capacitor 7). A notification is shown
  at once (bell updates, the test) or **scheduled** with Android's alarm service, so it comes at its
  time even when the app is closed or the phone was restarted.
- **Browser / installed web app:** the service worker's `registration.showNotification()` (the only
  way that works in Chrome on Android; `new Notification()` is the fallback on a computer). A
  browser can't wake a closed site without push, so here everything needs the app open.

## What comes when

| | Android app: closed (swiped away, phone restarted) | Android app: in the background / screen off | Android app: on screen | Browser (phone or computer) |
|---|---|---|---|---|
| Bell update (rate / item changed by someone else) | — (needs stage 2 push) | status-bar notification while Android keeps the app running | toast + bell badge only | system notification while the tab is hidden; toast + badge while it is visible; nothing when closed |
| To do reminder at its date and time (9:00 am without a time) | ✔ | ✔ | ✔ (status bar) | only while the app is open (a toast when it is on screen) |
| Udhaar summary (owner, managers) at the summary time | ✔ (amounts as of the last time the app was open) | ✔ | ✔ | only while open |
| Rent due on each rent due day (Rentals roles) | ✔ (needs the Rent page opened this month on this phone, like the rent reminder at the top of the Rent page; rent is not on Aadhat's Today) | ✔ | ✔ | only while open |
| Backup check (owner) 30 days after the last check on this phone | ✔ | ✔ | ✔ | only while open |
| Send test notification | one now + one 10 s later (close the app or lock the phone to try it) | ✔ | ✔ | one now |

Tapping a notification opens the app on the bell (bell updates), Today's Reminders (To do),
Outstanding (Udhaar), Rentals › Rent, or Admin › Data (backup check). In the browser the service
worker focuses the open tab and tells it where to go, or opens `/?notify=<page>`.

**Never for your own changes:** a bell notification document is never written for the person who made
the change (`planNotificationDocs` leaves the actor out), so their other phones get nothing either; the
app also drops any arrival marked with their own uid. Notification text is what the bell already shows;
amounts appear only in the Udhaar summary (owner, managers) and Rent due (Rentals roles).

## Settings › Help & about › Notifications (every platform)

- **Phone notifications** (master switch, this phone only). The phone's permission (Android 13+
  POST_NOTIFICATIONS through the plugin's `requestPermissions`, or `Notification.requestPermission()`
  in a browser) is asked **only** when this is switched on or **Send test notification** is tapped,
  never at start (the old start-up request in `MainActivity` is gone). Refused: the switch stays off,
  a toast and the card say where to allow it (phone settings › Apps › this app › Notifications, or the
  browser's site settings). Unset, the switch is on in the Android app once the phone allows
  notifications, and in the browser only for those who had the old "Desktop notifications" on.
- Per kind: **Bell updates**, **To do reminders** (everyone, on by default), **Udhaar summary**
  (owner and managers, on), **Rent due** (Rentals roles, on), **Backup check** (owner, on). A kind
  someone can't see in the app is not offered.
- **Daily summary time** (default 9:30 am): Udhaar summary, Rent due and Backup check.
- Stored per phone in localStorage `happa.notify` (`{on, bell, todo, udhaar, rent, backup, time}`).

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
`FirebaseService.sendNotification / notifyRateChanges / notifyItemEdit`.

## Catalogue

| type | sent when | recipients | status |
|---|---|---|---|
| `rate_change` | an item rate is changed (edit dialog or inline rate box; old value = value when editing started) | everyone except the person who changed it; wholesale rates: owners and managers only | live |
| `item_edit` (`action: added/updated`) | item added, or its name / Hindi name / contact changed | owners (except the person who changed it) | live |
| `edit` (`documentType`) | a bill / sale / payment was edited | owners | text supported; no sender wired yet |
| `review_flag` | an open review-queue flag | owners/managers | planned |
| `cash_mismatch` | cash session closed with a difference | owners/managers | planned |
| `stale_outbox` | writes not synced for a long time on a device | that user + owners | planned |
| `print_failure` | a bill failed to print | that user | planned |
| `backup_failure` | nightly backup failed | owners | planned |
| `shop_reminder` | shop reminders (#56) | as configured | planned |

New types only need a sender: unknown types are shown with their `message` /
`messageHi` fields. Use a stable `eventId` per flag/event so it notifies at
most once. User-facing text is always English + Hindi.

## Stage 2: push while closed (plan, not built)

Goal: bell updates (and a fresh Udhaar figure) reach a closed app. Still free.

1. **Sender:** a Cloudflare Worker (free plan: 100,000 requests a day) that sends with **FCM HTTP v1**
   (`https://fcm.googleapis.com/v1/projects/<project>/messages:send`; FCM itself is free). Two ways to
   trigger it:
   - **called by the client:** the phone that wrote a notification calls the Worker with its Firebase
     **ID token** and the event id; the Worker verifies the token (Google's public keys), reads the
     `notifications` docs of that event with a service account and sends one message per recipient
     token. Simple and immediate; nothing is sent if the writer is offline until it syncs.
   - **watching a path:** the Worker's cron trigger (every minute) lists `notifications` written since
     its last run (`timestamp >` a cursor kept in Workers KV). No client change, at most a minute late,
     about 1,440 small queries a day (inside the Firestore free reads).
   Firestore triggers (Cloud Functions) are not used: they need the Blaze plan.
2. **Tokens:** the Android app gets an FCM token from `@capacitor/push-notifications` (or
   `@capacitor-firebase/messaging`), the browser from `getToken()` with a VAPID key and a
   `firebase-messaging-sw` handler in our service worker. Stored in `users/{uid}/devices/{tokenHash}`
   (`token`, `platform`, `updatedAt`; the owner of the doc writes it, rules allow only their own); stale
   tokens (FCM 404 / UNREGISTERED) are deleted by the Worker.
3. **Payload:** a data message with the text the bell already shows and `route`; the app shows it on
   the "Bahi" channel with the same id 1001, so a bell update shown locally and by push stays one.
4. **Cost:** ₹0 at the shop's size (Workers free plan, FCM free, a few hundred Firestore reads a day).
5. **The owner creates:** a Cloudflare account and the Worker (we give the code and `wrangler.toml`); in
   Firebase (each project) a **service account key** for the Worker (stored as a Worker secret, never in
   the repo) and, for the browser, a **Web Push certificate (VAPID key)**; the Android app already has
   `google-services.json`. One review of the new rules for `devices`.
