# ADR-0008: Photo of weights uses Firebase AI Logic (Gemini) behind App Check

- **Status:** Accepted, opt-in; the owner switch is off by default. History: [D-015](../../project/DECISIONS.md#d-015--photo-of-weights-via-firebase-ai-logic--app-check).
- **Context:** Users want handwritten weight sheets read from a photo, and no API key may live in the app.
- **Decision:** The client calls Gemini through Firebase AI Logic. A separate, lazily loaded Firebase app makes the call, and it never touches Firestore. App Check (reCAPTCHA Enterprise) is enforced for AI Logic. The user reviews the lines before they are added, and nothing is stored.
- **Rationale:** There is no secret in the client, and App Check limits abuse.
- **Consequences:**
  - Each project needs an App Check site key.
  - Elsewhere App Check is monitor-only for now; enforcement on Auth is planned. Firestore stays unenforced while public receipt links read it without a token.
  - A review rule blocks other ML APIs.