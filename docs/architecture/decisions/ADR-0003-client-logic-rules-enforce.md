# ADR-0003: Business logic runs on the client, and Firestore rules enforce data access

- **Status:** Accepted. History: [ARCHITECTURE.md](../../project/ARCHITECTURE.md), [D-017](../../project/DECISIONS.md#d-017--void-never-delete-owner-edits-recorded-too), [D-019](../../project/DECISIONS.md#d-019--one-stored-due-per-bill-paymentdue).
- **Context:** There is no app server ([ADR-0002](ADR-0002-firebase-spark-no-backend.md)), but money data must not be tampered with or lost.
- **Decision:**
  - Every figure is computed by pure, tested client code, with one home per number.
  - Firestore rules enforce what clients may read and write. They take the role and status from the user's profile document (not custom claims) and check money shape, edit windows and counters.
  - Active bills can only be voided. An owner may then delete a voided bill and its edit records.
  - Privileged automation (the Apps Script sender, backup and TIP jobs) runs under separately managed identities.
- **Rationale:** This keeps the app on the free plan while giving every number a single, reviewable source.
- **Consequences:**
  - Rule checks read the user document, which costs reads.
  - Some page restrictions exist only in the UI ([role-permissions.md](../../role-permissions.md)).
  - Stock and party dues are derived from bills, not stored.
  - Emulator rules tests run on every PR and gate the production rules deploy. The test-project deploy publishes rules without re-running them.