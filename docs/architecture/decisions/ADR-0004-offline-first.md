# ADR-0004: Offline-first client

- **Status:** Accepted. History: [D-021](../../project/DECISIONS.md#d-021--offline-bill-numbers-per-device), [D-022](../../project/DECISIONS.md#d-022--oversell-warns-never-blocks).
- **Context:** Shops have patchy mobile data, and a sale must never wait for the network.
- **Decision:**
  - Firestore offline persistence is the device cache.
  - The service worker keeps the app shell available offline. Navigations go to the network first, and static assets come from the cache.
  - Bills get client-made ids.
    - Online, a first save of a purchase or retail bill is a create-only transaction; a wholesale bill is an ordinary write.
    - Offline, or when the create-only transaction gets no answer in time, the bill is queued as an ordinary write.
    - A copy restored from an auto-save or draft is strict: on timeout it fails instead of queueing.
  - Bill numbers come from a daily counter online, or a per-device sequence otherwise.
  - Retail oversell warns; wholesale may block above the configured shortfall threshold when stock is confirmed.
- **Rationale:** Billing keeps working with no connection, and the data syncs later.
- **Consequences:**
  - "Saved on this phone" is not the same as accepted by the server. A pending-sync indicator shows writes still waiting.
  - Retries need create-only semantics to avoid duplicate bills.
  - Cached data may be stale, so access checks favour the server copy when online.
  - Outdated clients are stopped by a minimum-version setting.