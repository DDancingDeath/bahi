# Bahi by happa: High-Level Design

Hindi/English billing, stock, cash and rentals app for small traders, on web and Android.

> As of `ce2207f8`, 2026-11-26. `diagrams/*.mmd` are canonical; embedded copies must match.
> Legend (flowcharts): blue = ours · purple = external · green = store · dashed border = Proposed · solid arrow = call/request · dashed arrow = event/background · thick arrow = deploy. Sequence diagrams use standard call/return notation.

## 1. Architecture overview

- **One shop per Firebase project**; no app server or Cloud Functions ([ADR-0002](decisions/ADR-0002-firebase-spark-no-backend.md)).
- **Thick vanilla-JS client** holds UI and business logic ([ADR-0001](decisions/ADR-0001-vanilla-spa-no-build.md)); the same `www/` runs on Hosting and in the APK ([ADR-0007](decisions/ADR-0007-android-capacitor-github-releases.md)).
- **Trust model:** Firestore rules enforce client data access; privileged automation (Apps Script sender, backup and test-in-production (TIP) jobs) uses separately managed identities. Some page restrictions are UI-only ([ADR-0003](decisions/ADR-0003-client-logic-rules-enforce.md)).
- **One data path in the signed-in app:** only its data layer talks to Firestore. A separate public page reads token-linked rent receipts without sign-in.
- **Offline-first:** device cache, service-worker shell, device bill numbers ([ADR-0004](decisions/ADR-0004-offline-first.md)).
- **Push without a server** via Apps Script + FCM ([ADR-0005](decisions/ADR-0005-push-via-apps-script.md)).
- **Ops in GitHub Actions:** deploys, backup, TIP bug filing.

## 2. System architecture (runtime)

[source](diagrams/system-architecture.mmd)

```mermaid
flowchart LR
    users(["Shop owner and staff"])
    tenant(["Tenant with receipt link"])

    subgraph PUBLIC["Tenant browser: no sign-in"]
        reader["Public receipt page<br/>read-only token link"]
    end

    subgraph DEVICE["Device boundary: browser PWA or Android APK"]
        ui["UI and navigation"]
        logic["Client business logic:<br/>billing, stock, dues, rentals"]
        data["Data access and realtime sync"]
        cache[("Device cache<br/>Firestore offline persistence")]
        sw["Service worker:<br/>offline shell + web push"]
        native["Native capabilities<br/>Capacitor + AppShell bridge:<br/>print, share, notifications, speech"]
    end

    subgraph THIRD["Third-party / peripherals"]
        printer[["Printers<br/>Bluetooth thermal, browser print"]]
        share[["WhatsApp / share targets"]]
        deskprint["Desktop thermal printing<br/>Proposed"]
        releases[("GitHub Releases<br/>APK + release info")]
    end

    subgraph GOOGLE["Google cloud boundary: shop's Google account"]
        subgraph FIREBASE["Firebase project, one per shop"]
            hosting["Firebase Hosting<br/>CSP + HSTS headers, web only"]
            auth["Firebase Auth"]
            fs[("Cloud Firestore<br/>guarded by security rules")]
            ai["Firebase AI Logic<br/>Gemini"]
            fcm["Firebase Cloud Messaging"]
            crash["Crashlytics"]
        end
        gas["Apps Script push sender<br/>runs as project owner"]
    end

    users -->|"HTTPS / APK"| ui
    tenant -->|"HTTPS"| reader
    reader -->|"Firestore REST, public get"| fs
    ui --> logic
    ui --> data
    data -.->|"data events"| ui
    data <-->|"cached reads,<br/>queued writes"| cache
    data -->|"Firestore SDK reads / writes"| fs
    fs -.->|"realtime snapshots"| data
    ui -->|"Auth SDK, HTTPS"| auth
    ui -->|"HTTPS + App Check,<br/>opt-in photo of weights"| ai
    sw -->|"HTTPS"| hosting
    data -->|"HTTPS POST event id"| gas
    gas -->|"Firestore REST"| fs
    gas -->|"FCM HTTP v1"| fcm
    fcm -.->|"web push"| sw
    fcm -.->|"Android push"| native
    ui -->|"Capacitor bridge"| native
    native -->|"Bluetooth thermal print"| printer
    ui -->|"browser print"| printer
    native -->|"native share"| share
    ui -->|"web share"| share
    native -.->|"crash reports"| crash
    ui -.-> deskprint
    ui -->|"HTTPS: update check / APK download"| releases

    classDef actor fill:#fff3cd,stroke:#b38f00,color:#000
    classDef internal fill:#e3f2fd,stroke:#1565c0,color:#000
    classDef external fill:#f3e5f5,stroke:#6a1b9a,color:#000
    classDef store fill:#e8f5e9,stroke:#2e7d32,color:#000
    classDef planned fill:#fafafa,stroke:#757575,color:#555,stroke-dasharray: 5 5
    class users,tenant actor
    class ui,logic,data,sw,native,gas,reader internal
    class hosting,auth,ai,fcm,crash,printer,share,releases external
    class fs,cache store
    class deskprint planned
```

## 3. Component responsibilities

| Component | Responsibility | Dependencies |
|---|---|---|
| UI and navigation (`index.html`, `js/main.js`, `modules/`, `rentals/`, `ui/`) | Boot, auth state, screens, `window.app` | Business logic, data layer |
| Business logic (`utils/calc/`, `business-metrics.js`, `rentals/rent-math*.js`) | Every displayed figure, as pure functions | None |
| Data layer (`js/firebase/`, `rentals/rent-*-store.js`) | Firestore access, listeners, collection prefix, read meter | Firestore SDK, device cache |
| Auth (`js/auth/`) | Email sign-in, pending registration | Firebase Auth |
| Services (`js/services/`) | Printing, sharing, audit, telemetry, App Check | Capacitor, AppShell bridge |
| Service worker (`service-worker.js`) | Offline shell, web push | Hosting, FCM |
| Rules (`firestore.rules`) | Data access and validation | Role and status in `users/{uid}` |
| Push sender (`push-sender/`) | FCM sends, 5-minute sweep | Firestore REST, FCM, owner account |
| Config (`happa.config.json`, `scripts/happa-config.js`) | App identity and build target | `config/targets/` |
| Public receipt page (`r.html`, `r/rent-history.js`) | Read-only rent history for a token link, no sign-in | Firestore REST, public `rent_public` get |

## 4. Data architecture

Each Firebase project holds one shop, with collections at the root. Bills are the source for **derived** stock and party dues. Each bill embeds its lines and keeps its edits in a subcollection, and stock checkpoints bound the replay. Firestore is the durable store; the device cache serves offline use. Rentals publish a read-only receipt projection for tenant links.

[source](diagrams/data-model.mmd)

```mermaid
erDiagram
    USER ||--o{ BILL : "creates"
    USER ||--o{ NOTIFICATION : "receives"
    BILL ||--o{ BILL_EDIT : "edits subcollection"
    COUNTER |o--o{ BILL : "numbers when online"
    BILL }o--o{ ITEM : "embedded lines reference"
    ITEM ||--o{ STOCK_ADJUSTMENT : "adjusted by"
    BILL }o--o| ON_DEVICE_PARTY_DUE_VIEW : "dues summed into"
    BILL }o--|| ON_DEVICE_STOCK_VIEW : "replayed into"
    STOCK_ADJUSTMENT }o--|| ON_DEVICE_STOCK_VIEW : "replayed into"
    STOCK_CHECKPOINT ||--|| ON_DEVICE_STOCK_VIEW : "snapshot, replayed forward"
    CASH_SESSION ||--o{ EXPENSE : "same day"
    CASH_SESSION ||--o{ WITHDRAWAL : "same day"
```

[source](diagrams/data-model-rentals.mmd)

```mermaid
erDiagram
    PROPERTY ||--o{ UNIT : has
    PROPERTY ||--o{ RENT_EXPENSE : "expenses"
    UNIT ||--o{ LEASE : "let via"
    TENANT ||--o{ LEASE : signs
    TENANT ||--o| DEPOSIT_LEDGER : "deposit ledger"
    LEASE ||--o{ CHARGE : "monthly charges"
    CHARGE ||--o{ RECEIPT : "one per payment entry"
    LEASE ||--o| PUBLIC_RECEIPT_LINK : "public read-only projection"
```

## 5. Critical workflows

### Boot and billing

[source](diagrams/critical-workflows.mmd)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Client UI and logic
    participant D as Data layer and device cache
    participant A as Firebase Auth
    participant F as Firestore and rules
    participant P as Printer

    Note over C,A: Boot: the client subscribes to Firebase Auth. For a signed-in user it reads the profile.<br/>A missing, pending, rejected or disabled profile stops at the sign-in or pending screen.
    Note over D,F: Then settings and the stock checkpoint load. History listeners start from the checkpoint,<br/>items in parallel. Snapshots fill app state and the start page renders.

    U->>C: enter lines and payment, then Save or Print
    C->>C: totals and checks: retail oversell warns, wholesale may block above the shortfall limit
    C->>D: next bill number
    alt online
        D->>F: daily counter transaction
    else offline or counter timeout
        D-->>C: device sequence number
    end
    C->>D: save bill with client-made id
    par save
        alt purchase or retail, online
            D->>F: create-only transaction
        else wholesale, online
            D->>F: ordinary write
        else new bill: offline or no answer in time
            D->>D: queue ordinary write in device cache
            D-)F: sync later, rules check on arrival
        end
    and print, if requested
        C->>P: new bill: starts as soon as the save is issued
    end
    Note over C,F: Restored copy: must reach the server (fails on timeout) and prints only after the save
    alt server accepted or locally queued
        D-->>C: saved, or saved on this phone
        F--)D: realtime snapshots
        D-->>C: stock and dues recomputed on device
        C-->>U: confirmation
    else server refused
        D-->>C: error, form kept
        Note over C,P: No successful save, though the print may already have started
    end
```

1. Boot authenticates and loads the working state.
2. Billing calculates locally, then saves online or queues offline; new bills may print before server acceptance; restored copies after.
3. Realtime snapshots refresh stock and dues.

**Offline writes:** "saved on this phone" is not server acceptance. The sync pill counts pending writes; a later rules refusal is logged to TIP, not shown per bill (§9).

### Push notification

[source](diagrams/workflow-push-notification.mmd)

```mermaid
sequenceDiagram
    autonumber
    participant W as Writer client
    participant DB as Firestore
    participant G as Apps Script sender
    participant F as FCM HTTP v1
    participant R as Recipient device

    Note over R,DB: Earlier: each recipient registers a push token under its user doc
    W->>DB: batch write notification docs, one per recipient
    W-)G: HTTPS POST event id, fire and forget, unprefixed collections only
    G->>DB: Firestore REST as project owner: read docs and recipient tokens
    alt web token
        G->>F: data-only message
        F-)R: service worker shows the notification
    else Android token
        G->>F: notification + data message
        F-)R: OS shows it, even when the app is closed
    end
    G->>DB: mark docs pushed, drop stale tokens
    loop every 5 minutes
        G->>DB: sweep docs not yet pushed, e.g. from offline writers
        G->>F: send
        G->>DB: mark pushed
    end
    Note over F,R: App open: the unread listener shows the bell badge without push
```

1. The writer stores notification docs and pings the sender.
2. The sender reads Firestore (REST) and sends via FCM: data-only to the web, notification to Android. A 5-minute sweep covers offline writers.

### Backup and restore drill

[source](diagrams/workflow-backup-restore.mmd)

```mermaid
sequenceDiagram
    autonumber
    participant S as GitHub schedule
    participant B as firestore-backup.yml
    participant DB as Firestore bahi-happa
    participant A as Actions artifacts
    participant DR as backup-restore-drill.yml
    participant E as Firestore emulator
    participant I as GitHub Issues

    rect rgb(232, 245, 233)
        Note over S,I: Daily 08:15 UTC
        S->>B: cron
        B->>DB: count documents
        alt above 40,000 docs and not forced
            B-->>S: fail, nothing exported
        else scheduled, above 15,000 docs and not Sunday IST
            B-->>S: skip, weekly only at this size
        else otherwise: export runs
            Note over B,A: Sunday IST: full export incl. logs.<br/>Other days: business data, without auditLogs, telemetry, tipHealth, tipFailures
            B->>DB: export, Admin SDK
            B->>A: encrypt AES-256, upload, 60-day retention
            B->>A: verify job: decrypt, parse, compare counts
        end
        B->>I: alert job: open, update or close issue
    end

    rect rgb(255, 243, 224)
        Note over S,I: Monthly drill, 3rd at 09:00 UTC
        S->>DR: cron
        DR->>A: download newest weekly artifact, else newest nightly
        DR->>E: decrypt, restore, read every document back
        DR->>I: open or close drill alert issue
    end
```

1. Business data nightly; a full export including logs weekly. Encrypted, 60-day retention.
2. A verify job and an alert issue; a monthly restore drill into the emulator.
3. Volume limits can reduce or stop scheduled backups (`tools/backup/`).

**Photo of weights (opt-in):** AI Logic + App Check; the user confirms the lines; nothing is stored.

## 6. Deployment

[source](diagrams/deployment-architecture.mmd)

```mermaid
flowchart LR
    devx(["Developer"])

    subgraph TRIG["Triggers"]
        pr["Pull request"]
        main["Push to main"]
        tag["Tag v*"]
        sched["Schedule"]
    end

    subgraph GH["GitHub Actions"]
        gates["PR checks<br/>ci, e2e, review-rules, migration-e2e"]
        prprev["firebase-hosting-pull-request.yml"]
        merge["firebase-hosting-merge.yml"]
        rulesdep["firestore-rules-deploy.yml<br/>emulator rules tests first"]
        devdep["bahi-dev-deploy.yml<br/>no rules tests"]
        pushdep["push-sender-deploy.yml"]
        apk["android-release.yml<br/>manual dev target: pre-release;<br/>otherwise debug or tagged release"]
        nightly["Scheduled or manual, not PR gates<br/>bench, mutation, nightly e2e,<br/>prod smoke, backup, TIP"]
        rel[("GitHub Releases<br/>signed APK")]
    end

    subgraph GOOGLE["Shop's Google account"]
        subgraph PROD["Firebase project bahi-happa: production"]
            psite["Hosting<br/>bahi-happa.web.app"]
            pfs[("Firestore rules + indexes")]
        end
        subgraph DEV["Firebase project bahi-happa-dev: test"]
            dproj["Hosting: bahi-happa-dev.web.app<br/>+ PR preview channels<br/>Firestore rules + indexes"]
        end
        gas["Apps Script push sender<br/>serves both projects"]
    end

    devx ==> pr
    devx ==> main
    devx ==> tag
    pr ==> gates
    pr ==>|"build for dev target"| prprev
    prprev ==>|"preview channel deploy"| dproj
    main ==> merge
    merge ==>|"1. rules + indexes"| rulesdep
    rulesdep ==>|"deploy"| pfs
    merge ==>|"2. Hosting deploy"| psite
    main ==> devdep
    devdep ==>|"Hosting + rules + indexes"| dproj
    main ==>|"push-sender/** changed"| pushdep
    pushdep ==>|"clasp push"| gas
    tag ==> apk
    apk ==>|"sign + publish"| rel
    sched -.-> nightly
    nightly -.->|"prod smoke; backup + TIP<br/>via Admin SDK"| PROD

    classDef actor fill:#fff3cd,stroke:#b38f00,color:#000
    classDef internal fill:#e3f2fd,stroke:#1565c0,color:#000
    classDef external fill:#f3e5f5,stroke:#6a1b9a,color:#000
    classDef store fill:#e8f5e9,stroke:#2e7d32,color:#000
    class devx actor
    class pr,main,tag,sched,gates,prprev,merge,rulesdep,devdep,pushdep,apk,nightly,gas internal
    class psite,dproj external
    class pfs,rel store
```

| Environment | Firebase project | Entry point |
|---|---|---|
| Production | `bahi-happa` | `bahi-happa.web.app`, APK `com.happa` |
| Test | `bahi-happa-dev` | `bahi-happa-dev.web.app`, PR previews, APK `com.happa.dev` |
| Local | checked-in config, i.e. `bahi-happa` | `localhost` |

The build target picks the **project**; the runtime picks the **collection prefix**. By default the prefix is `dev_` on browser localhost and preview channels, and none elsewhere. `?env=`, `?prod=1` (previews) or a saved `appEnv` override it. Rollback: Hosting release history, a reverted commit for rules, and fix-forward for Android behind `minClientVersion`.

## 7. Key decisions

[0001 No build step](decisions/ADR-0001-vanilla-spa-no-build.md) · [0002 Spark, no backend](decisions/ADR-0002-firebase-spark-no-backend.md) · [0003 Client logic, rules enforce](decisions/ADR-0003-client-logic-rules-enforce.md) · [0004 Offline-first](decisions/ADR-0004-offline-first.md) · [0005 Push via Apps Script](decisions/ADR-0005-push-via-apps-script.md) · [0006 Prod/test projects](decisions/ADR-0006-prod-dev-projects.md) · [0007 APK via GitHub Releases](decisions/ADR-0007-android-capacitor-github-releases.md) · [0008 AI Logic + App Check](decisions/ADR-0008-photo-weights-ai-logic.md). History is in [DECISIONS.md](../project/DECISIONS.md).

## 8. Non-functional considerations

| Quality | Approach |
|---|---|
| Scalability | Bounded by the Spark quota (50k reads a day). Controls: a history window, the stock checkpoint, per-page read baselines, a session cap and a kill switch for background reads. |
| Availability | Google-managed services. The app works offline from the service-worker shell and the device cache. |
| Performance | Budgets in [performance-budget.md](../performance-budget.md): selected metrics benchmarked nightly (`tools/bench/budgets.json`); others checked by release measurements and telemetry. |
| Security | Rules tests run on every PR and before the production rules deploy (the test deploy skips them). CSP and HSTS come from Hosting headers (web only; the APK WebView has no CSP); SRI on vendored SDKs. No secrets in the client. App Check is enforced for AI Logic. |
| Reliability | Client-made ids make saves idempotent. Rules deploy before Hosting, and a post-deploy build check follows. Backup plus restore drill. |
| Monitoring | Telemetry, the audit log, an anomaly scan, Crashlytics, TIP issues and a nightly production smoke test. |
| Config and secrets | Public identity lives in `happa.config.json`. Deploy keys live only in GitHub secrets. |

## 9. Assumptions and open questions

| Item | State |
|---|---|
| One shop per project; multi-shop would need a new project or a schema change | Assumption |
| Localhost uses the production project, with `dev_` collections | Open risk |
| Some page permissions are UI-only | Known gap |
| App Check on Auth and Firestore is monitor-only now; Auth enforcement is planned | Known state |
| A queued bill later refused by the rules has no per-bill alert | Open question |
| Production restore: [procedure exists](../../tools/backup/README.md#3-restore-into-bahi-happa-production); validated run and measured RTO | Open |
| Android WebView runs without CSP | Known risk |
| Desktop thermal printing | Planned |


## 10. Keeping this current

In any PR that changes the architecture, update the canonical `.mmd`, its embedded copy and the affected ADR. Architectural changes include services, schema, auth, integrations, background jobs, deployment and major flows. Draw anything not yet built dashed, labelled **Proposed**.
