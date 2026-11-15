# Photo of weights (#374)

Status: in the app, **off until the owner switches it on** (Settings › Aadhat › Photo of
weights, saved for every phone in `settings/app.photoWeights`). It needs Firebase AI Logic
switched on in the Firebase project first (console steps below). Purchase bills only for now.

## What it does

When on, Purchase billing shows **Photo of weights** under the weight box, for everyone:
owner, managers and members. One tap:

1. opens the phone's camera (`<input type="file" accept="image/*" capture="environment">`;
   a computer opens the file picker). Offline, it says "No internet. Please type the
   weights." and puts the cursor in the weight box instead;
2. makes the photo upright and smaller on the phone (at most 1600 px on the long side,
   JPEG 0.8) and sends only that to Gemini through Firebase AI Logic, with the prompt and
   answer schema of the accuracy spike (`www/js/utils/photo-weights.js`);
3. shows a **check sheet** (the shared app sheet): the photo with a numbered box on each
   weight, then the weights in the same order, column by column and top to bottom.
   Unclear readings are yellow (the cursor starts on the first one); crossed-out entries
   are listed apart and left out unless put back (**Add back**). Each weight can be changed
   or removed and more added. The bag count and total are shown, and checked against a
   total or bag count written on the sheet (a mismatch warns, it never blocks). A bag over
   100 kg is flagged and asked at **Add N weights** with the same question as a typed one
   (BF-BAGCHECK);
4. **Add N weights** only puts the weights into the line's bag chips, after any already
   entered. The user still picks the item and rate, taps Add to bill and saves. The photo
   never adds a line and never saves a bill.

Spec: PW-1 in [calculations.md](calculations.md). Page doc: [Billing](pages/billing.md).

## Messages (en / hi, `msg.photo_weights.*`)

| Case | What the user sees | Then |
|---|---|---|
| Offline | "No internet. Please type the weights." | Cursor in the weight box |
| Free daily limit used up (HTTP 429 / `RESOURCE_EXHAUSTED`) | "Photo reading limit reached for today — please type the weights." | **Type the weights**; no retry |
| AI Logic not switched on, App Check refused, model gone (401 / 403 / 404) | "Reading photos is not working right now. Please type the weights." | **Type the weights** |
| No weights found | "No weights found in the photo. Take it closer, or type the weights." | **Retake photo** or **Type the weights** |
| Other failure or 25 s timeout | "Couldn't read the photo. Take it again or type the weights." | **Retake photo** or **Type the weights** |

There is no daily cap of our own (owner, 15 Nov 2026: about 10 photos a day expected); the
free tier's own limit is the cap.

## How it is built

| File | Role |
|---|---|
| `www/js/ui/photo-weights.js` | The button and the owner's switch (start-up code, small). Opens the camera from the tap itself. `PHOTO_FORMS` lists the forms: add Retail / Wholesale there later |
| `www/js/modules/photo-weights.js` | Imported on the first photo: shrinks it, calls the reader, the check sheet, the hand-off to `PurchaseManager.addWeights` (`TARGETS` per form) |
| `www/js/utils/photo-weights.js` | Pure: the model name (`PHOTO_WEIGHTS_MODEL`), prompt, schema, reading the answer (PW-1), count / total / sheet check, box rotation, the message for an error |
| `www/js/firebase/photo-weights-ai.js` | Firebase AI Logic: imports the vendored modular SDK (`vendor/firebase/13.2.0`, the compat SDK has no AI) on the first photo, starts it as a second Firebase app **with the running app's own config** (no project id in the code), App Check when a site key is set, `getAI(…, GoogleAIBackend)` and `generateContent` with JSON output |

- **Model:** `gemini-3.5-flash-lite` (the current stable Flash-Lite on Firebase AI Logic,
  billing not required). The spike used the `gemini-flash-lite-latest` alias, which Firebase
  advises against in production. Change the one constant when Google retires the model.
- **Photos are never stored:** not in Firestore, Storage or on the phone. The full photo is
  dropped as soon as it is shrunk; the small one lives in memory while the sheet is open.
  Only the weights the user adds end up in the bill, as when typed.
- **App Check:** used only when `happa.config.json` has `appCheck.siteKey` (the same
  reCAPTCHA v3 key as `js/services/app-check.js`); without one the call goes without a token.
  `PHOTO_APP_CHECK_REQUIRED` in `photo-weights-ai.js` makes it required (then no token =
  "not working right now").
- **Headers (web only; the APK gets none):** `connect-src` has
  `https://firebasevertexai.googleapis.com`. `Permissions-Policy` is `camera=(self)` on the
  app site (frames, the tenant page and the redirect sites keep `camera=()`). A file input
  with `capture` opens the phone's own camera app and is not governed by the `camera`
  feature (that covers `getUserMedia`), so `camera=()` would most likely not have blocked
  it; `(self)` keeps an in-page camera possible later. Check on a real phone.
- **Android app:** Capacitor opens the system camera (`ACTION_IMAGE_CAPTURE`) for this input
  (`accept` must be exactly `image/*`). No CAMERA permission is needed or added.
- **Usage counters (on the phone only):** `photo_weights.read`, `photo_weights.added`,
  `photo_weights.edited` (Settings › Usage on this phone): how often a reading needed a change.

## Console steps for the owner (we don't do these)

Do them on the **current dev project `bahi-happa-dev` first**, test, then `bahi-happa`
(live today). At the rename cut-over (#375) repeat them on **`happa-bahi-dev`** and
**`happa-bahi`**: the code follows whichever project the build's Firebase config points at.

1. **Turn on AI Logic.** Firebase console › the project › AI Services › **AI Logic** ›
   Get started › **Gemini Developer API**. It enables the Firebase AI Logic API
   (`firebasevertexai.googleapis.com`) and the Gemini API, and allows AI Logic on the web
   API key. Do **not** create or add a Gemini API key to the app.
2. **App Check (recommended; can come later).** Firebase console › Security › App Check:
   register the web app with **reCAPTCHA v3** (the same provider the app already uses in
   monitor mode, #89) for the app's domain, and put the site key in `happa.config.json`
   (`appCheck.siteKey`) for that build. Then in App Check › APIs, **Firebase AI Logic**:
   leave it unenforced until the APK works too (reCAPTCHA can't attest the APK's
   `https://localhost`; enforcing would block the Android app until a native Play Integrity
   provider is added). Never enforce Firestore here (#89 is separate).
3. **Check the free limit.** AI Studio (signed in as the owner) › the project › rate limits:
   note the requests per day for `gemini-3.5-flash-lite`.
4. **Then in the app** (as owner): Settings › Aadhat › Photo of weights › on. Test a few
   real sheets on the dev site before switching it on for the live shop.

## Still to do

- Accuracy: 3 sample sheets read with no edit (spike, 15 Nov 2026); the go rule is ≥95% of
  sheets with no edit on 30+ more real photos. The usage counter `photo_weights.edited`
  measures it in the shop.
- A test on real phones: the camera opening in the Android app and in Chrome, rotation,
  the free limit message.
- Retail and Wholesale (add them to `PHOTO_FORMS` and `TARGETS`).
- App Check for the Android app (native Play Integrity provider) before enforcing it.
