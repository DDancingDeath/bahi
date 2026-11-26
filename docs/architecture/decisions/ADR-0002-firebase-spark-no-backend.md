# ADR-0002: Firebase on the free Spark plan, with no app server and no Cloud Functions

- **Status:** Accepted (mirrors [D-016](../../project/DECISIONS.md#d-016--free-spark-plan-read-budget-no-cloud-functions) and [D-002](../../project/DECISIONS.md#d-002--firebase-compat-sdk-modular-only-for-ai-logic))
- **Context:** The shop pays nothing for hosting. Spark allows 50k reads and 20k writes a day for the whole project. The old project ran out of quota on 2026-10-21.
- **Decision:** Use Firebase Hosting, Auth and Firestore directly from the client through the compat SDK. Run no Cloud Functions or triggers, because they need the Blaze plan. Only the photo feature uses the modular SDK.
- **Rationale:** No server to run, patch or pay for. Firestore gives realtime sync and an offline cache out of the box.
- **Consequences:** Every feature is judged by how many reads it costs. Controls include a recent-history window, a stock checkpoint, per-page read baselines (`tests/e2e/read-baselines.json`), a session read cap and `firestore-meter.js`. Background work has to happen elsewhere: Apps Script ([ADR-0005](ADR-0005-push-via-apps-script.md)) and GitHub Actions (backup, TIP).
