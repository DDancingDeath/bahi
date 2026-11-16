# Photo of weights (#374)

Status: in the app, **off until the owner switches it on** (Settings › Billing tools › Photo of
weights, saved for every phone in `settings/app.photoWeights`). It needs Firebase AI Logic
switched on in the Firebase project first (console steps below). Purchase bills only for now.

## What it does

When on, Purchase billing shows the **Photo of weights** camera button beside the weight box, for everyone:
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
| Gemini busy (HTTP 500 "high demand" / 503 `UNAVAILABLE`) | "Busy, trying again…" (`ui.photo_weights.busy`) in place of "Reading the weights…" | Tried again by itself after 1.5 s, then 4 s (`OVERLOAD_RETRY_DELAYS_MS`, 2 retries, inside the 25 s timeout); Cancel or the timeout stops it and nothing more is sent. Still busy → "Couldn't read the photo…" |
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
- **App Check (required):** AI Logic enforces App Check (since 2 Nov 2026), so
  `PHOTO_APP_CHECK_REQUIRED` is true: without `appCheck.siteKey` in `happa.config.json`, or when
  reCAPTCHA can't start, Gemini is never called and the photo button says "not working right
  now"; nothing else in the app changes. With a key the photo app gets App Check with
  `ReCaptchaEnterpriseProvider` (the same reCAPTCHA Enterprise key as `js/services/app-check.js`,
  which loads `enterprise.js` first) and token auto-refresh, and `getAI(…, { useLimitedUseAppCheckTokens: true })`
  sends a limited-use token with every call. bahi-happa-dev and bahi-happa (and so the APK from
  rc15) have a key (docs/security.md, "App Check"); myhappa (happa-bfc07) can't read photos until
  it has one.
- **Headers (web only; the APK gets none):** `connect-src` has
  `https://firebasevertexai.googleapis.com`. `Permissions-Policy` is `camera=(self)` on the
  app site (frames, the tenant page and the redirect sites keep `camera=()`). A file input
  with `capture` opens the phone's own camera app and is not governed by the `camera`
  feature (that covers `getUserMedia`), so `camera=()` would most likely not have blocked
  it; `(self)` keeps an in-page camera possible later. Check on a real phone.
- **Android app:** Capacitor opens the system camera (`ACTION_IMAGE_CAPTURE`) for this input
  (`accept` must be exactly `image/*`). No CAMERA permission is needed or added.
- **Usage counters (on the phone only):** `photo_weights.read`, `photo_weights.added`,
  `photo_weights.edited` (Settings › Help & about › Usage on this phone): how often a reading needed a change.

## Console steps for the owner (we don't do these)

Do them on the **current dev project `bahi-happa-dev` first**, test, then `bahi-happa`
(live today). These are also the cut-over targets (#72), so nothing needs repeating there: the code
follows whichever project the build's Firebase config points at. (The earlier pair `happa-bahi` /
`happa-bahi-dev` was retired on 15 Nov 2026.)

1. **Turn on AI Logic.** Firebase console › the project › AI Services › **AI Logic** ›
   Get started › **Gemini Developer API**. It enables the Firebase AI Logic API
   (`firebasevertexai.googleapis.com`) and the Gemini API, and allows AI Logic on the web
   API key. Do **not** create or add a Gemini API key to the app.
2. **App Check (required: AI Logic enforces it).** Google Cloud console › the project ›
   Security › reCAPTCHA › create a **score** website key (domains: the app's `*.web.app` site and
   `localhost`, which the APK's WebView uses). Firebase console › Security › App Check › the web app ›
   **reCAPTCHA Enterprise** › that site key (v3 is no longer accepted). Put the site key in that
   build's config (`appCheck.siteKey`; for the APK, `config/targets/<target>.json`). Never enforce
   Firestore here (#89 is separate). Done on bahi-happa-dev (15 Nov 2026) and bahi-happa (16 Nov 2026).

**Done by API instead of the console (16 Nov 2026)**, with an editor's token (firebase CLI login), for
the record and for happa-bfc07 later:

| Step | API call |
|---|---|
| APIs on | `serviceusage` `services:batchEnable` firebasevertexai, generativelanguage, firebaseappcheck, recaptchaenterprise |
| AI Logic "genai config" (= Get started › Gemini Developer API) | `PATCH firebasevertexai.googleapis.com/v1beta/projects/<p>/locations/global/config?updateMask=generativeLanguageConfig` body `{"generativeLanguageConfig":{}}`. No Gemini API key: AI Logic no longer needs one (the `apiKey` field is deprecated). Without this config every call fails with "Firebase AI Logic genai config not found". |
| reCAPTCHA key | `POST recaptchaenterprise.googleapis.com/v1/projects/<p>/keys` (`webSettings.integrationType` SCORE, `allowedDomains` the sites + `localhost`) |
| App Check provider | `PATCH firebaseappcheck.googleapis.com/v1/projects/<p>/apps/<webAppId>/recaptchaEnterpriseConfig?updateMask=siteKey,tokenTtl` (`tokenTtl` 3600s); `?updateMask=riskAnalysis.minValidScore` body `{"riskAnalysis":{"minValidScore":0.3}}` (0.3 since 16 Nov 2026, docs/security.md) |
| Enforce | `PATCH firebaseappcheck.googleapis.com/v1beta/projects/<p>/services/firebaseml.googleapis.com?updateMask=enforcementMode` `ENFORCED` (`firebasevertexai.googleapis.com` is not an App Check service id) |

bahi-happa: key `6LeLOiMuAAAAAFwG1zM7ElYJWZlvqpxROKr2qpCp` (display name "Bahi"; bahi-happa.web.app,
bahi-happa.firebaseapp.com, localhost). Neither project has a Gemini API key; their Firebase browser /
Android keys don't list `generativelanguage.googleapis.com`, so they can't call Gemini directly. If a
Gemini key is ever made, restrict it to `generativelanguage.googleapis.com` and never put it in the app.

**Headless checks:** reCAPTCHA scores a headless browser low (0.3 on bahi-happa-dev's key; under the
minimum score → "App attestation failed", 403). To test the AI path there, register a short-lived App Check
debug token (`apps/<id>/debugTokens`), set `self.FIREBASE_APPCHECK_DEBUG_TOKEN` before the page loads,
and delete the token afterwards.
3. **Check the free limit.** AI Studio (signed in as the owner) › the project › rate limits:
   note the requests per day for `gemini-3.5-flash-lite`.
4. **Then in the app** (as owner): Settings › Billing tools › Photo of weights › on. Test a few
   real sheets on the dev site before switching it on for the live shop.

## Still to do

- Accuracy: 3 sample sheets read with no edit (spike, 15 Nov 2026); the go rule is ≥95% of
  sheets with no edit on 30+ more real photos. The usage counter `photo_weights.edited`
  measures it in the shop.
- A test on real phones: the camera opening in the Android app and in Chrome, rotation,
  the free limit message.
- Retail and Wholesale (add them to `PHOTO_FORMS` and `TARGETS`).
- Optional: a native Play Integrity provider for the APK (it uses the web reCAPTCHA key on `localhost` today).
