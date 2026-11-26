# ADR-0005: Push while the app is closed goes through Google Apps Script and FCM v1

- **Status:** Accepted (mirrors D-024 in [DECISIONS.md](../../project/DECISIONS.md))
- **Context:** Cloud Functions triggers need Blaze ([ADR-0002](ADR-0002-firebase-spark-no-backend.md)). The owner did not want a service-account key stored anywhere.
- **Decision:** `push-sender/` is an Apps Script web app that runs as the project owner. The writing phone stores `notifications` docs and then POSTs the event id (`firebase/push-trigger.js`). The script reads Firestore over REST with its OAuth token, sends through FCM HTTP v1, marks docs `pushed` and removes stale tokens. A sweep every 5 minutes catches writers that were offline. `push-sender-deploy.yml` deploys it with clasp.
- **Rationale:** It is free, needs no keys, and one web app serves both projects.
- **Consequences:**
  - Apps Script quotas and its owner account are a dependency.
  - Delivery waits up to 5 minutes for writers that were offline.
  - The instant trigger fires only for unprefixed collections.
  - Web push needs a VAPID key, and the APK needs `google-services.json`.
