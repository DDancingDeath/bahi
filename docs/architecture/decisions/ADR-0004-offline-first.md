# ADR-0004: Offline-first client

- **Status:** Accepted (related to [D-021](../../project/DECISIONS.md#d-021--offline-bill-numbers-per-device) and [D-022](../../project/DECISIONS.md#d-022--oversell-warns-never-blocks))
- **Context:** Shops have patchy mobile data, and a sale must never wait for the network.
- **Decision:**
  - `firebaseConfig.js` turns on Firestore IndexedDB persistence (`synchronizeTabs`).
  - `service-worker.js` precaches the shell and templates (versioned cache `happa-v780`, checked by `check:sw`). Navigations (`index.html`) are network-first with a cached fallback; static assets are cache-first.
  - Bills get client-made ids and are written to the local queue through `core/write-settle.js`.
  - Online, bill numbers come from a transaction on `counters`. Offline, they are per device: `{prefix}{YYYYMMDD}-{device}-{seq}`.
  - Selling more than the stock shows only warns.
- **Rationale:** Billing keeps working with no connection, and sync happens later.
- **Consequences:**
  - Retried saves and conflicts need create-only writes, payment signatures and "saved on phone only" states.
  - Data in the cache may be stale. The profile is a normal `get()` (server, cache only when offline), and a missing or pending profile is re-read from the server.
  - Old cached clients are stopped by `settings/app.minClientVersion`.
