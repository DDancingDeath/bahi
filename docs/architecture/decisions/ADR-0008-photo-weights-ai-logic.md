# ADR-0008: Photo of weights uses Firebase AI Logic (Gemini) behind App Check

- **Status:** Accepted, opt-in; the owner switch is off by default (mirrors [D-015](../../project/DECISIONS.md#d-015--photo-of-weights-via-firebase-ai-logic--app-check))
- **Context:** Users want to read handwritten weight sheets from a photo. No API key may live in the app.
- **Decision:** `firebase/photo-weights-ai.js` lazily loads the vendored modular SDK 13.2.0 as a second Firebase app that never touches Firestore. It calls Gemini through AI Logic with App Check (reCAPTCHA Enterprise, limited-use tokens) enforced. The user reviews the lines before they are added, and nothing is stored.
- **Rationale:** No secret in the client, and abuse is limited by App Check.
- **Consequences:**
  - The feature needs an App Check site key per project.
  - Elsewhere, App Check runs in monitor mode (`services/app-check.js`), and Firestore is deliberately not enforced while `/r/` makes unauthenticated REST reads.
  - The review rule `no-external-ml-api` blocks other ML APIs.
