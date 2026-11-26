# Bahi by happa: High-Level Design

Hindi/English billing, stock, cash, money and rentals app for small traders (web + Android).

> **As of** `ce2207f8` (`main`), 2026-11-26.
> **The files in `diagrams/*.mmd` are canonical.** Keep the embedded copies below in sync with them.
> For layer rules, see [ARCHITECTURE.md](../project/ARCHITECTURE.md). For the decision log, see [DECISIONS.md](../project/DECISIONS.md).

**Legend:** blue = our code · purple = managed/external service or peripheral · green cylinder = data store · grey dashed = Proposed or retired · yellow = actor. Arrows: `-->` sync, `-.->` async/event, `==>` deploy/CI.

## 1. System architecture

Source: [`diagrams/system-architecture.mmd`](diagrams/system-architecture.mmd)

```mermaid
flowchart LR
    owner(["Shop owner"])
    staff(["Manager / Member staff"])
    tenant(["Tenant with receipt link"])

    subgraph DEVICE["Device boundary: browser PWA or Android APK via Capacitor"]
        direction TB
        ui["Presentation<br/>index.html, templates/*.html via template-loader.js,<br/>modules/*.js, rentals/rentals.js, ui/*.js,<br/>window.app facade in main.js"]
        calc["Client business logic, pure<br/>utils/calc/*, money, business-metrics,<br/>finance-calc, labour, statements, rent-math"]
        state["AppState + events<br/>utils/state.js, utils/events.js"]
        data["Data access<br/>FirebaseService facade, firebase/repos/*,<br/>firebase/core/* listeners, rentals/rent-*-store.js"]
        cache[("Firestore offline cache<br/>IndexedDB persistence")]
        cross["Cross-cutting<br/>auth/*, i18n, theme, services/telemetry,<br/>audit, crash-reports, security-monitor, app-check"]
        aiclient["firebase/photo-weights-ai.js<br/>modular SDK, opt-in"]
        sw["service-worker.js<br/>cache happa-v780"]
        cap["Capacitor plugins<br/>bluetooth-serial, speech-recognition,<br/>local-notifications, share,<br/>firebase auth / messaging / crashlytics"]
    end

    subgraph THIRD["Third-party / peripherals"]
        direction TB
        printer[["Bluetooth thermal printer"]]
        share[["WhatsApp / share targets"]]
        deskprint["Desktop printing<br/>Proposed"]
    end

    subgraph GOOGLE["Google cloud boundary: shop's Google account"]
        direction TB
        subgraph FIREBASE["Firebase project bahi-happa"]
            direction TB
            hosting["Firebase Hosting<br/>firebase.json: CSP, HSTS, rewrites"]
            fauth["Firebase Auth<br/>email + password"]
            rules{{"firestore.rules<br/>roles from users/uid doc"}}
            fs[("Cloud Firestore")]
            ai["Firebase AI Logic<br/>Gemini"]
            fcm["Firebase Cloud Messaging"]
            crash["Crashlytics"]
        end
        gas["Apps Script push-sender<br/>push-sender/Main.js + Core.js"]
    end

    subgraph GH["GitHub boundary: DDancingDeath/bahi"]
        direction TB
        devx(["Developer / CI"])
        actions["GitHub Actions<br/>CI, deploy, backup, TIP"]
        releases[("GitHub Releases<br/>bahi.apk, read by app-updates.js")]
        issues["GitHub Issues<br/>alerts + TIP bugs"]
        artifacts[("Encrypted backup artifacts<br/>60 days")]
    end

    owner -->|"HTTPS / APK"| ui
    staff -->|"HTTPS / APK"| ui
    tenant -->|"/r/ page: REST read rent_public"| fs
    ui --> calc
    ui --> data
    data -->|"populate"| state
    state -.->|"refresh:view events"| ui
    data <-->|"cached reads, queued writes"| cache
    cross -->|"telemetry, auditLogs docs"| data
    data -->|"Firestore SDK WebChannel, onSnapshot"| rules
    rules --> fs
    cross -->|"HTTPS Auth SDK"| fauth
    ui --> aiclient
    cross -.->|"App Check token"| aiclient
    aiclient -->|"HTTPS, App Check enforced"| ai
    sw -->|"HTTPS fetch + precache"| hosting
    data -->|"HTTPS POST eventId, push-trigger.js"| gas
    gas -->|"Firestore REST + OAuth"| fs
    gas -->|"FCM HTTP v1"| fcm
    fcm -.->|"push"| cap
    fcm -.->|"web push"| sw
    cap -->|"BT SPP, ESC/POS raster"| printer
    cap -->|"ACTION_SEND / Web Share / wa.me"| share
    cap -.->|"crash reports"| crash
    ui -.-> deskprint

    devx ==>|"git push / PR / tag"| actions
    actions ==>|"deploy Hosting, rules + indexes"| FIREBASE
    actions ==>|"clasp push"| gas
    actions ==>|"signed APK"| releases
    actions -.->|"daily export, Admin SDK"| fs
    actions -.->|"encrypt + upload"| artifacts
    actions -.->|"alerts, TIP auto-bugs"| issues

    classDef actor fill:#fff3cd,stroke:#b38f00,color:#000
    classDef internal fill:#e3f2fd,stroke:#1565c0,color:#000
    classDef external fill:#f3e5f5,stroke:#6a1b9a,color:#000
    classDef store fill:#e8f5e9,stroke:#2e7d32,color:#000
    classDef planned fill:#fafafa,stroke:#757575,color:#555,stroke-dasharray: 5 5
    class owner,staff,tenant,devx actor
    class ui,calc,state,data,cross,aiclient,sw,cap,gas internal
    class hosting,fauth,rules,ai,fcm,crash,actions,issues,printer,share external
    class fs,cache,releases,artifacts store
    class deskprint planned
```

## 2. Overview

- **Serverless and single-tenant.** One Firebase project holds one shop. There are no Cloud Functions ([ADR-0002](decisions/ADR-0002-firebase-spark-no-backend.md)).
- **Thick vanilla-JS client.** The maths is pure client code, and pages are reached through `window.app` ([ADR-0001](decisions/ADR-0001-vanilla-spa-no-build.md)).
- **`firestore.rules` is the only server-side check** ([ADR-0003](decisions/ADR-0003-client-logic-rules-enforce.md)).
- **One data path.** Only `FirebaseService` and the repositories touch Firestore. `onSnapshot` fills `AppState`, and the data layer emits `refresh:<view>` events.
- **Offline-first** ([ADR-0004](decisions/ADR-0004-offline-first.md)).
- **Background work:**
  - Apps Script and FCM send push ([ADR-0005](decisions/ADR-0005-push-via-apps-script.md)).
  - GitHub Actions runs backup, TIP and deploys.
- **The same `www/` runs everywhere.** Hosting serves it, and the Capacitor APK ships it ([ADR-0007](decisions/ADR-0007-android-capacitor-github-releases.md)).

## 3. Data architecture

Source: [`diagrams/data-model.mmd`](diagrams/data-model.mmd)

```mermaid
erDiagram
    USERS ||--o{ USER_DEVICES : "devices subcollection"
    USERS ||--o{ USER_PREFERENCES : "preferences subcollection"
    USERS ||--o{ NOTIFICATIONS : receives
    USERS ||--o{ AUDIT_LOGS : "actor of"
    ITEMS ||--o{ BILL_LINE : "itemId"
    PURCHASES ||--|{ BILL_LINE : "items array"
    RETAIL_SALES ||--|{ BILL_LINE : "items array"
    WHOLESALE_SALES ||--|{ BILL_LINE : "items array"
    PURCHASES ||--o{ BILL_EDITS : "edits subcollection"
    RETAIL_SALES ||--o{ BILL_EDITS : "edits subcollection"
    WHOLESALE_SALES ||--o{ BILL_EDITS : "edits subcollection"
    COUNTERS ||--o{ RETAIL_SALES : "numbers bills"
    ITEMS ||--o{ STOCK_ADJUSTMENTS : adjusts
    STOCK_CHECKPOINTS ||--o{ ITEMS : "snapshot per item"
    CASH_MANAGEMENT ||--o{ WITHDRAWALS : "same day"
    CASH_MANAGEMENT ||--o{ EXPENSES : "same day"
    RENT_PROPERTIES ||--o{ RENT_UNITS : has
    RENT_UNITS ||--o{ RENT_LEASES : "let via"
    RENT_TENANTS ||--o{ RENT_LEASES : signs
    RENT_LEASES ||--o{ RENT_CHARGES : "monthly"
    RENT_LEASES ||--o{ RENT_RECEIPTS : "paid by"
    RENT_LEASES ||--o| RENT_PUBLIC : "share token snapshot"

    USERS {
        string uid PK
        string role "owner, manager, staff"
        string status "approved, pending, rejected"
        string rentRole
        string lang
    }
    ITEMS {
        string id PK
        string name
        array rates "purchase rates"
        array saleRates
        array wholesaleRates
    }
    RETAIL_SALES {
        string id PK "client-made id"
        string billNumber "S yyyymmdd-nnn"
        number total
        map payment "cash, online, due"
        string userId FK
        number timestamp
        bool voided
    }
    BILL_LINE {
        string itemId FK
        number rate
        number qty
        number total
    }
    BILL_EDITS {
        number n PK "edit number"
        string by FK
        string reason
        map fields "changed fields"
    }
    COUNTERS {
        string id PK "P, S or W plus yyyymmdd"
        number next "last issued number"
    }
    CASH_MANAGEMENT {
        string sessionId PK "one per day"
        number openingBalance
        number closingBalance
    }
    RENT_LEASES {
        string id PK
        string unitId FK
        string tenantId FK
    }
    RENT_PUBLIC {
        string token PK "world-readable"
    }
```

There is **no per-shop hierarchy**: all collections sit at the root. `getCollection()` adds `dev_` on localhost and preview hosts. **Dues and stock are derived** from bills, and `payment.due` is the only stored due.

| Collections | Owner | Pattern |
|---|---|---|
| `purchases`, `retailSales`, `wholesaleSales` (+`edits`) | `repos/bill-*`, `core/listeners` | Realtime recent window plus open-due queries; create-only save; payments use transactions |
| `items`, `itemFrequency`, `stockAdjustments`, `stockCheckpoints`, `rate*`, `monthStats` | `repos/items`, `stock-records`, `bill-stats` | Items listener; stock = checkpoint + replay |
| `cashManagement`, `expenses`, `personalExpense*`, `withdrawals` | `repos/cash-*`, `expenses` | On demand; transactions or increments |
| `settings`, `counters` | `repos/settings`, `counters` | One read per app open; daily counter transaction |
| `users` (+`devices`, `preferences`), `workers`, `deviceLog` | `repos/users`, `user-profiles`, `push-devices` | Profile `get()`: server, cache when offline |
| `notifications`, `reminders`, `drafts`, `autoSaves`, `recurringBills` | matching `repos/*` | Batched writes; unread listener |
| `auditLogs`, `telemetry`, `anomalies`, `tip*` | matching `repos/*` | Append-only |
| `rent_*` | `rentals/rent-*-store.js` | Loaded with Rentals; `rent_public` is world-readable |

## 4. Component responsibilities

| Component | Responsibility | Depends on | Path |
|---|---|---|---|
| Shell and boot | Load order, theme, SW registration | Firebase compat 10.7.1 | `www/index.html`, `js/boot/` |
| Bootstrap | Auth state, user init, `window.app`, lazy pages | FirebaseService | `js/main.js`, `utils/template-loader.js` |
| Pages | Render calc results | AppState, events | `js/modules/`, `js/rentals/`, `js/ui/` |
| Business logic | Pure figures with spec IDs | none | `utils/calc/`, `business-metrics.js`, `finance-calc.js`, `labour.js`, `statements.js` |
| State | Store and event bus | none | `utils/state.js`, `events.js` |
| Data layer | Firestore, prefix, listeners, read meter | Firestore SDK | `js/firebase/` |
| Auth | Email sign-in, pending registration | Firebase Auth | `js/auth/` |
| Services | Print, share, audit, telemetry, App Check | Capacitor | `js/services/` |
| PWA | Precache, offline shell, web push | Hosting | `service-worker.js` |
| Config | Identity, targets, project guard | none | `happa.config.json`, `scripts/happa-config.js` |
| Rules | AuthZ and validation | Emulator tests | `firestore.rules`, `rules-tests/` |
| Push sender | FCM v1 and the sweep | Firestore REST | `push-sender/` |
| CI/CD | Gates, deploy, backup, TIP | Actions | `.github/workflows/`, `tools/` |

## 5. Critical workflows

### Boot and creating a bill

Source: [`diagrams/critical-workflows.mmd`](diagrams/critical-workflows.mmd)

```mermaid
sequenceDiagram
    autonumber
    actor U as Shop user
    participant SW as service-worker.js
    participant UI as index.html + main.js
    participant AU as auth/authentication.js
    participant FA as Firebase Auth
    participant FS as FirebaseService + repos
    participant C as Offline cache IndexedDB
    participant ST as AppState
    participant R as firestore.rules
    participant DB as Cloud Firestore
    participant P as services/printer.js + printer-link.js

    rect rgb(232, 245, 253)
        Note over U,DB: A. Boot and sign-in
        U->>SW: open app
        SW-->>UI: index.html network-first, cached copy when offline
        SW-->>UI: JS, CSS, templates cache-first from precache
        UI->>AU: onAuthStateChanged
        AU->>FA: session restore or email + password sign-in
        UI->>FS: initializeUserData: users/uid profile get
        FS->>DB: default get: server, falls back to offline cache
        opt profile missing or pending
            FS->>DB: second read with source server
        end
        alt pending or rejected
            UI-->>U: pending screen or sign-out
        end
        par settings and version gate
            FS->>DB: settings/app read, minClientVersion check
        and realtime listeners
            FS->>DB: onSnapshot items, recent bills window, open dues, itemFrequency
            DB-->>FS: snapshots, cache first then server
        end
        FS->>ST: populate AppState
        FS-->>UI: emit refresh:view
        UI-->>U: start page renders from AppState
    end

    rect rgb(232, 245, 233)
        Note over U,P: B. Create a retail bill, retail-sale.js
        U->>UI: add lines, payment, tap Save or Print
        UI->>UI: utils/calc/billing totals, BillChecksUI.confirmSave, oversell warns only
        UI->>FS: Helpers.generateBillNumber S
        alt online
            FS->>DB: transaction on counters/S YYYYMMDD
        else offline
            FS-->>UI: per-device number prefix date-device-seq
        end
        UI->>FS: saveRetailSale, createOnly, client id, payment.due
        FS->>C: write queued locally, settleWrite
        FS->>R: server write when online
        R->>DB: validate money, roles, edit window, no-backdated-cash
        opt Print
            UI->>P: PrinterService.printBill, ESC/POS raster over BT SPP
        end
        UI->>FS: background: AuditService.log, itemFrequency, delete autoSave
        DB-->>FS: onSnapshot change
        FS->>ST: AppState updated, stock and party due recomputed in client
        UI-->>U: saved toast, optional WhatsApp share via bill-image-share.js
    end
```

**Boot:**
1. The SW serves `index.html` network-first, with a cached fallback; other assets come from the precache.
2. Auth restores the session.
3. Profile `get()` (cache only when offline); a missing or pending profile is re-read from the server, and a pending user is gated.
4. `settings/app` (`minClientVersion`) loads alongside the listeners, which fill `AppState`; the page renders.

**Creating a bill:**
1. Calc and `BillChecksUI` validate the bill. Overselling only warns.
2. The bill number comes from a counter transaction online, or a per-device sequence offline.
3. The create-only write is queued locally, then checked by the rules.
4. Printing starts once the write is issued.
5. Audit and `itemFrequency` update in the background.
6. The listener refreshes stock and dues.

### Push notification

Source: [`diagrams/workflow-push-notification.mmd`](diagrams/workflow-push-notification.mmd)

```mermaid
sequenceDiagram
    autonumber
    actor A as Actor phone, e.g. edits a rate
    participant N as repos/notifications.js
    participant DB as Cloud Firestore
    participant T as push-trigger.js
    participant G as Apps Script push-sender
    participant F as FCM HTTP v1
    participant D as Recipient device

    Note over D,DB: Earlier: recipient registers token in users/uid/devices/id via push-notify.js + repos/push-devices.js
    A->>N: sendNotification eventId, recipients
    N->>DB: batch write notifications, doc id per event + recipient, read false
    N->>T: triggerPush eventId, prod collections only
    T-)G: HTTPS POST eventId + project, no-cors, fire and forget
    G->>DB: Firestore REST with owner OAuth token: read event docs + recipients' devices
    alt device platform web
        G->>F: data-only message, webpush Urgency high
        F-)D: service worker receives data and shows the notification
    else Android
        G->>F: notification + data message, channel_id bahi, priority HIGH
        F-)D: OS shows it when app is backgrounded or closed, FirebaseMessaging plugin
    end
    G->>DB: mark docs pushed, delete stale tokens
    loop every 5 minutes
        G->>DB: sweep docs written since last sweep, not pushed, e.g. offline writers
        G->>F: send, same per-platform message
        G->>DB: mark pushed
    end
    Note over D: App open: unread listener shows bell badge and toast without push
```

1. Docs are written in a batch, then `push-trigger.js` POSTs the event id (production only).
2. Apps Script reads the docs over REST and sends through FCM v1: data-only to the web (the SW shows it), notification+data to Android (the OS shows it when the app is closed).
3. It marks the docs `pushed` and prunes stale tokens.
4. A 5-minute sweep catches writers that were offline.

### Backup and restore drill

Source: [`diagrams/workflow-backup-restore.mmd`](diagrams/workflow-backup-restore.mmd)

```mermaid
sequenceDiagram
    autonumber
    participant S as GitHub schedule
    participant B as firestore-backup.yml
    participant DB as Firestore bahi-happa
    participant A as Actions artifact store
    participant DR as backup-restore-drill.yml
    participant E as Firestore emulator
    participant I as GitHub Issues

    rect rgb(232, 245, 233)
        Note over S,I: Daily run 08:15 UTC, tools/backup/export-firestore.js
        S->>B: cron
        B->>B: resolve project, guard refuses aadhat-management
        B->>DB: count documents
        alt above 40,000 docs, BACKUP_HARD_MAX
            B->>I: job fails, nothing exported unless force=true
        else above 15,000 docs, BACKUP_WEEKLY_ABOVE, and not Sunday IST
            B-->>S: skip, weekly only at this size
        else Sunday IST: weekly mode
            B->>DB: full export incl. auditLogs, telemetry, tipHealth, tipFailures
        else other days: nightly mode
            B->>DB: export, excluding auditLogs, telemetry, tipHealth, tipFailures
        end
        B->>B: compress, AES-256 encrypt, remove plaintext
        B->>A: upload firestore-backup-nightly or -weekly, 60-day retention
        B->>A: verify job: download, checksums, decrypt, parse, compare counts
        B->>I: open, update or close backup alert issue
    end

    rect rgb(255, 243, 224)
        Note over S,I: Monthly restore drill, 3rd of month 09:00 UTC
        S->>DR: cron
        DR->>A: download newest weekly artifact, else newest nightly
        DR->>DR: checksums, decrypt, parse, compare counts
        DR->>E: restore into emulator, read every document back
        DR->>I: open or close drill alert issue
    end
```

1. Runs daily at 08:15 UTC:
   - Nightly runs skip `auditLogs`, `telemetry`, `tipHealth` and `tipFailures`.
   - The Sunday (IST) weekly run exports everything.
   - Above 15,000 docs, scheduled runs are weekly only; above 40,000 the job fails unless forced (`BACKUP_WEEKLY_ABOVE`, `BACKUP_HARD_MAX`).
   - Exports are encrypted with AES-256 and kept for 60 days.
2. A verify job checks the counts; alert issues open or close.
3. Monthly, the drill restores the newest **weekly** artifact (else the newest nightly) into the emulator and reads it back.

### Photo of weights (opt-in)

1. `photo-weights-ai.js` loads the modular SDK as a separate app, with an App Check token.
2. It calls Gemini through AI Logic.
3. The user confirms the lines. Nothing is stored.

## 6. Deployment architecture

Source: [`diagrams/deployment-architecture.mmd`](diagrams/deployment-architecture.mmd)

```mermaid
flowchart LR
    devx(["Developer"])

    subgraph TRIG["Triggers"]
        direction TB
        pr["Pull request"]
        main["push to main"]
        tag["tag v* / rc, or manual run"]
        sched["Schedules, UTC"]
    end

    subgraph WF["GitHub Actions workflows"]
        direction TB
        gates["ci.yml, e2e.yml, review-rules.yml,<br/>migration-e2e, bench, mutation"]
        prprev["firebase-hosting-pull-request.yml"]
        merge["firebase-hosting-merge.yml"]
        rulesdep["firestore-rules-deploy.yml<br/>rules tests in emulator, then deploy"]
        devdep["bahi-dev-deploy.yml<br/>rules via REST, no rules tests"]
        pushdep["push-sender-deploy.yml<br/>paths push-sender/**"]
        apk["android-release.yml"]
        backup["firestore-backup.yml<br/>daily 08:15, weekly full on Sunday"]
        drill["backup-restore-drill.yml<br/>monthly, 3rd 09:00"]
        tip["tip-autobugs.yml<br/>daily 08:30"]
    end

    subgraph GHS["GitHub storage"]
        direction TB
        rel[("GitHub Releases<br/>bahi.apk latest, bahi-dev.apk dev-latest")]
        art[("Encrypted backup artifacts<br/>nightly + weekly, 60 days")]
        iss["GitHub Issues<br/>TIP bugs + job alert issues"]
        emu["Firestore emulator<br/>in the drill runner"]
    end

    subgraph PROD["Firebase project bahi-happa: production"]
        direction TB
        psite["Hosting bahi-happa.web.app"]
        pdb[("Firestore, unprefixed collections")]
        psvc["Auth, AI Logic, FCM"]
    end

    subgraph DEV["Firebase project bahi-happa-dev: test"]
        direction TB
        dsite["Hosting bahi-happa-dev.web.app"]
        dprev["Preview channels<br/>bahi-happa-dev--prN, 2-day expiry"]
        ddb[("Firestore: unprefixed on site,<br/>dev_ on preview channels")]
    end

    gas["Apps Script push-sender<br/>one web app serves both projects"]

    subgraph RETIRED["Retired / archived: never deployed from main"]
        direction TB
        old1["happa-bfc07 sites<br/>hosting-redirect/ 301 to bahi-happa.web.app"]
        old2["aadhat-management<br/>blocked by happa-config.js guard"]
    end

    devx ==> pr
    devx ==> main
    devx ==> tag
    pr ==> gates
    pr ==>|"target bahi-happa-dev"| prprev
    main ==> merge
    main ==> devdep
    main ==> pushdep
    tag ==> apk
    sched -.-> backup
    sched -.-> drill
    sched -.-> tip

    prprev ==>|"channel deploy"| dprev
    merge ==>|"1. rules + indexes"| rulesdep
    rulesdep ==>|"Rules API"| pdb
    merge ==>|"2. Hosting + BUILD_ID check"| psite
    devdep ==>|"rules, indexes, Hosting"| dsite
    pushdep ==>|"clasp push"| gas
    apk ==>|"sign + publish"| rel
    backup -.->|"export, Admin SDK"| pdb
    backup -.->|"encrypt + verify"| art
    drill -.->|"download newest weekly"| art
    drill -.->|"restore + read back"| emu
    tip -.->|"read tip docs"| pdb
    tip -.->|"bugs"| iss
    gas -->|"Firestore REST, FCM v1"| psvc
    gas -.->|"same, dev project"| ddb
    old1 -.->|"301"| psite

    classDef actor fill:#fff3cd,stroke:#b38f00,color:#000
    classDef internal fill:#e3f2fd,stroke:#1565c0,color:#000
    classDef external fill:#f3e5f5,stroke:#6a1b9a,color:#000
    classDef store fill:#e8f5e9,stroke:#2e7d32,color:#000
    classDef retired fill:#eeeeee,stroke:#9e9e9e,color:#555,stroke-dasharray: 5 5
    class devx actor
    class pr,main,tag,sched,gates,prprev,merge,rulesdep,devdep,pushdep,apk,backup,drill,tip,gas,emu internal
    class psite,psvc,dsite,dprev,iss external
    class pdb,ddb,rel,art store
    class old1,old2 retired
```

| Environment | Project | Entry | Collections | Deployed by |
|---|---|---|---|---|
| Production | `bahi-happa` | `bahi-happa.web.app`, `com.happa` | unprefixed | `firebase-hosting-merge.yml` (rules first); `android-release.yml` on `v*` |
| Test | `bahi-happa-dev` | `bahi-happa-dev.web.app`, `com.happa.dev` | unprefixed | `bahi-dev-deploy.yml`; manual `dev-latest` APK |
| PR preview | `bahi-happa-dev` | `…--pr<N>-…` channels | `dev_` | `firebase-hosting-pull-request.yml` |
| Local | checked-in config **`bahi-happa`**, or `?emulator=1` | `localhost` | `dev_` | developer |
| Retired / archived | `happa-bfc07` / `aadhat-management` | 301 / none | read-only / never | `hosting-redirect/` / blocked by guard |

**Rollback:** Hosting release history; rules by revert; Android fixes forward behind the `minClientVersion` gate.

## 7. Cross-cutting concerns

| Concern | Approach |
|---|---|
| AuthN | Firebase Auth email/password; new users start as `pending` staff. Google sign-in is built but off. |
| AuthZ | Rules read the role and status from `users/{uid}`; there are no custom claims. Some page permissions are UI-only ([role-permissions.md](../role-permissions.md)). |
| Boundaries | Enforced CSP, HSTS, `nosniff`, frame deny; SRI on vendored SDKs. App Check is enforced for AI Logic and monitors everything else. |
| Monitoring | `telemetry`, `auditLogs`, `security-monitor.js` feeding anomalies, Crashlytics, TIP issues, nightly prod smoke |
| Config and secrets | Public identity lives in `happa.config.json` and `config/targets/`. Service-account, signing and clasp secrets live only in GitHub secrets. |
| Errors | `write-settle.js` save states, `getWithRetry`, idempotent client ids, alert issues |

## 8. Key decisions

| ADR | Decision | Source |
|---|---|---|
| [0001](decisions/ADR-0001-vanilla-spa-no-build.md) | Vanilla SPA, no build step | D-001 |
| [0002](decisions/ADR-0002-firebase-spark-no-backend.md) | Spark plan, no backend | D-016, D-002 |
| [0003](decisions/ADR-0003-client-logic-rules-enforce.md) | Client logic, rules enforce | D-017, D-019 |
| [0004](decisions/ADR-0004-offline-first.md) | Offline-first | D-021, D-022 |
| [0005](decisions/ADR-0005-push-via-apps-script.md) | Push through Apps Script | D-024 |
| [0006](decisions/ADR-0006-prod-dev-projects.md) | Prod and test projects, `dev_` prefix | D-004 |
| [0007](decisions/ADR-0007-android-capacitor-github-releases.md) | APK through GitHub Releases | D-003 |
| [0008](decisions/ADR-0008-photo-weights-ai-logic.md) | AI Logic with App Check | D-015 |

## 9. Non-functional considerations

| Quality | Approach |
|---|---|
| Scalability | The limit is Spark quota (50k reads a day). Controls: history window, stock checkpoint, per-page read baselines (hard cap 300), session cap, `pauseBackgroundReads` kill switch. |
| Availability | Google-managed services; offline use from the SW precache and the IndexedDB cache. |
| Performance | [performance-budget.md](../performance-budget.md), checked nightly by `bench.yml`. Three pages load eagerly; the rest lazily. |
| Security | Rules tests run in the emulator on every PR and before the production deploy (the dev deploy skips them). No client secrets. Active bills are voided; only an owner may then delete a voided bill and its edits. |
| Reliability | Backup + drill (audit and logs only weekly); idempotent saves; rules before Hosting; `BUILD_ID` check. |

## 10. Assumptions, open questions and gaps

| Item | State |
|---|---|
| One shop per project | Assumption |
| Push while closed needs clasp secrets, a VAPID key and `GOOGLE_SERVICES_JSON` | Implemented, depends on configuration |
| Crashlytics and native Google sign-in need `GOOGLE_SERVICES_JSON` | Partial |
| App Check enforcement for Auth is a console setting | Open question |
| Localhost writes `dev_*` into the **production** project; the comment in `firebaseConfig.js` is stale (#35) | Open question |
| Role checks that are UI-only | Known gap |
| `services/` layer ([ARCHITECTURE.md §2](../project/ARCHITECTURE.md)) | Partial |
| Desktop printing ([desktop-printing.md](../desktop-printing.md)) | Planned |
| Browser reminders fire only while the app is open | Partial |
| Nightly backups omit logs; above 15,000 docs scheduled backups are weekly only | Known limit |
| AGENTS.md rule 7 mentions Functions; the DECISIONS.md index lacks D-024 | Doc gap |

## 11. Keeping this HLD current

Update the HLD in the **same PR** as any of these changes. Edit the `.mmd` file, then re-embed it here.

| Change | Update |
|---|---|
| A service, integration or external API | System diagram, §4, §7 |
| Collections, prefixing or derived data | Data model, §3 |
| Auth, roles or rules | §7, ADR-0003 |
| Communication patterns or background jobs | System and workflow diagrams |
| An environment, workflow or release channel | Deployment diagram, §6 |
| A major flow (boot, billing, sync) | `critical-workflows.mmd` |
| A hard-to-reverse choice | A new ADR plus a DECISIONS.md entry |

Draw anything not yet built with the dashed `planned` class, labelled **"Proposed"**. Bump the as-of line whenever you update this page.
