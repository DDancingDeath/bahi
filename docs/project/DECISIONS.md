# Decision log

> **Status:** Living log · **Owner:** Hitesh (owner) · **Last reviewed:** 2026-11-21
>
> **What this file is:** a short record of decisions already made, and why, so nobody re-argues
> them. It links to the authoritative home of each rule and never replaces it: the rules
> themselves live in [AGENTS.md](../../AGENTS.md), [firestore.rules](../../firestore.rules) and the
> docs indexed in [RULES.md](RULES.md). Work items live in GitHub issues ([TASKS.md](TASKS.md)).

## How to use

- One entry per consequential, hard-to-reverse choice (stack, data, money, permissions, names the
  shop sees). Not for routine bug fixes.
- Format (lightweight [Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) /
  [MADR](https://adr.github.io/madr/)): **ID** `D-NNN` (next free number, never reused) · **Status**
  `Proposed` | `Accepted` | `Superseded by D-NNN` | `Deprecated` · **Date** (ISO, when decided or first
  recorded) · **Decider** · **Related** · Context · Options · Decision · Consequences · **Confirmation**
  (the test, guard or check that keeps it true). Keep each entry under ~15 lines.
- Every entry cites evidence (a file or PR). Unknown facts say `not recorded` or `TBD`, never a guess.
- Add or update an entry **in the same PR** that makes or changes the decision. To reverse one, add a
  new entry and mark the old one `Superseded by D-NNN`; don't delete history.
- The skill [.github/skills/decision-record](../../.github/skills/decision-record/SKILL.md) writes entries in this format.

PR links point to `https://github.com/DDancingDeath/bahi/pull/N`; `#N` alone is an issue or PR in
this repo.

## Index

| ID | Decision | Status |
|---|---|---|
| D-001 | No build step or framework | Accepted |
| D-002 | Firebase compat SDK (modular only for AI Logic) | Accepted |
| D-003 | Android = Capacitor APK from tagged GitHub Releases | Accepted |
| D-004 | Live on `bahi-happa`, test on `bahi-happa-dev`; old projects never written | Accepted |
| D-005 | App name Bahi, brand happa | Accepted |
| D-006 | Migration: fresh start with opening dues | Accepted |
| D-007 | Rentals data and roles come from happa only | Accepted |
| D-008 | Hindi weight unit stays "kg" | Accepted |
| D-009 | Purchase party is called "Customer" | Accepted |
| D-010 | Billing: option C floating labels | Accepted |
| D-011 | Bottom tab says "Dues" | Accepted |
| D-012 | Members' default permissions are narrow | Accepted |
| D-013 | PIN worker accounts are Member-only | Accepted |
| D-014 | Billing: WhatsApp and Due always visible | Accepted |
| D-015 | Photo of weights via Firebase AI Logic + App Check | Accepted |
| D-016 | Free Spark plan, read budget, no Cloud Functions | Accepted |
| D-017 | Void, never delete; owner edits recorded too | Accepted |
| D-018 | "Overdue" = bills more than 30 days old | Accepted |
| D-019 | One stored due per bill: `payment.due` | Accepted |
| D-020 | Several owners, never none | Accepted |
| D-021 | Offline bill numbers per device | Accepted |
| D-022 | Oversell warns, never blocks | Accepted |
| D-023 | Rentals: one view, no Simple / Advanced | Accepted |
| D-025 | A recurring-bill payment is one expense; everyone with the page pays | Accepted |
| D-026 | Worker pay is one expense too (Salaries) | Accepted |

---

### D-001 — No build step or framework
- **Status** Accepted · **Date** 2026-05-09 (recorded) · **Decider** Owner · **Related** [AGENTS.md §2 rule 3](../../AGENTS.md), #89
- **Context** Recorded in AGENTS.md as "a deliberate choice": what is in `www/` is exactly what phones run.
- **Options** Bundler + framework (Vite/React) · vanilla ES modules with `window.app` globals.
- **Decision** Vanilla ES modules, no bundler, no framework; files under `www/` are served as written.
  UI handlers are delegated `data-on*` attributes since the CSP work (#89, [PR #337](https://github.com/DDancingDeath/bahi/pull/337)).
- **Consequences** No tree-shaking: start-up weight is managed by lazy `import()` and the precache budget.
- **Confirmation** Review rules `framework-import`, `ts-file-introduced` ([review-rules.yml](../../.github/review-rules.yml)); `inline-handlers.test.js`.

### D-002 — Firebase compat SDK (modular only for AI Logic)
- **Status** Accepted · **Date** 2026-05-09 (recorded) · **Decider** Owner · **Related** [AGENTS.md §4](../../AGENTS.md), D-015
- **Context** The app relies on `firebase.*` compat globals across all repositories.
- **Decision** Keep the compat SDK. Only exception: the vendored modular `firebase/ai` for photo of
  weights, run as a second app without Firestore ([PR #487](https://github.com/DDancingDeath/bahi/pull/487)).
- **Consequences** No modular-SDK size savings; one extra code path for AI.
- **Confirmation** `firebase-app-shadow.test.js`; architecture guard (no Firebase imports outside repositories).

### D-003 — Android = Capacitor APK from tagged GitHub Releases
- **Status** Accepted · **Date** 2026-11-08 (tag flow) · **Decider** Owner · **Related** [AGENTS.md §5 "Releasing"](../../AGENTS.md), [release-checklist.md](../release-checklist.md)
- **Context** Users in the field run the Android build as well as the website (AGENTS.md §2).
- **Decision** Wrap `www/` with Capacitor; a `v*` tag builds and signs `bahi.apk` and publishes a GitHub
  Release; rc tags publish as latest; `/download` links the latest APK ([PR #384](https://github.com/DDancingDeath/bahi/pull/384)).
- **Consequences** Updates reach phones via the in-app update card, not a store.
- **Confirmation** `android-release.yml`; `npm run check:release`.

### D-004 — Live on `bahi-happa`, test on `bahi-happa-dev`; old projects never written
- **Status** Accepted · **Date** 2026-11-16 · **Decider** Owner · **Related** #72, [PR #429](https://github.com/DDancingDeath/bahi/pull/429), [PR #531](https://github.com/DDancingDeath/bahi/pull/531), [happa-go-live.md](../happa-go-live.md)
- **Context** Production data had to move to the shop's own Google account, with a separate test project.
- **Decision** `main` deploys prod `bahi-happa` and test `bahi-happa-dev`; PR previews use dev only. The old
  app's `aadhat-management` is archived and never deployed to; `happa-bfc07` is retired (redirects, read-only rules).
- **Consequences** Two service-account secrets; dev mistakes never touch shop data.
- **Confirmation** `scripts/happa-config.js guard` fails on anything resolving to `aadhat-management`; `npm run check:happa-config`.

### D-005 — App name Bahi, brand happa
- **Status** Accepted · **Date** 2026-11-08 · **Decider** Owner · **Related** #375, [PR #392](https://github.com/DDancingDeath/bahi/pull/392)
- **Decision** App name "Bahi" (en and hi); brand always lowercase "happa"; Android package stays `com.happa` so installs update in place.
- **Confirmation** Values come from [happa.config.json](../../happa.config.json); `npm run check:happa-config`.

### D-006 — Migration: fresh start with opening dues
- **Status** Accepted · **Date** 2026-10-25 · **Decider** not recorded · **Related** [tools/migrate/README.md](../../tools/migrate/README.md)
- **Context** Moving from the old app without copying years of bills (reads, risk).
- **Options** `--mode full` (copy every bill) · `--mode fresh` (default).
- **Decision** Fresh start: old bills stay in the old project and the encrypted backup; each old unpaid bill
  becomes one opening record in Outstanding; items, rates, users, settings and today's bill counters carry over.
- **Consequences** History before the cut-over is not in the app; opening stock and cash are entered by hand.
- **Confirmation** `migrate-plan.test.js`, `migrate-apply.test.js`, `npm run test:migration-e2e`.

### D-007 — Rentals data and roles come from happa only
- **Status** Accepted · **Date** 2026-11-07 · **Decider** Owner · **Related** [PR #370](https://github.com/DDancingDeath/bahi/pull/370), [tools/migrate/README.md](../../tools/migrate/README.md)
- **Context** The owner decided the Rentals data already entered in happa (`happa-bfc07`) is real and must survive go-live.
- **Decision** Migration never writes `rent_*` or `rentRole` from the old app; `wipe` keeps Rentals data and helpers.
- **Confirmation** `migrate-plan.test.js` / `migrate-apply.test.js` refuse `rent_*` writes.

### D-008 — Hindi weight unit stays "kg"
- **Status** Accepted · **Date** 2026-11-01 · **Decider** Owner · **Related** [AGENTS.md §4](../../AGENTS.md), [glossary.md](../glossary.md), [PR #510](https://github.com/DDancingDeath/bahi/pull/510)
- **Decision** In Hindi the weight unit is always "kg" ("50 kg", "₹/kg"), never a Hindi word for kilo or quintal.
- **Confirmation** `hindi-kg-unit.test.js`; the mixed-language guard allows `kg`.

### D-009 — Purchase party is called "Customer"
- **Status** Accepted · **Date** 2026-11-15 (v730) · **Decider** Owner · **Related** [PR #522](https://github.com/DDancingDeath/bahi/pull/522), [PR #519](https://github.com/DDancingDeath/bahi/pull/519)
- **Decision** On every Purchase screen, share and doc the party label is "Customer".
- **Consequences** Code ids keep supplier naming; only `t()` text changed.

### D-010 — Billing: option C floating labels
- **Status** Accepted · **Date** 2026-11-15 · **Decider** Owner · **Related** [PR #500](https://github.com/DDancingDeath/bahi/pull/500), [design-system.md](../design-system.md)
- **Options** Three phone mock-ups (A, B, C).
- **Decision** Option C: labels float on the field border, 14 px labels, Item wider than Rate; `.field-float` reusable (later also Wholesale, [PR #514](https://github.com/DDancingDeath/bahi/pull/514)).
- **Consequences** Later UX fixes must leave this layout alone (respected in PR #519).

### D-011 — Bottom tab says "Dues"
- **Status** Accepted · **Date** 2026-11-15 · **Decider** UX review, shipped with owner approval (PR #519) · **Related** [PR #504](https://github.com/DDancingDeath/bahi/pull/504) (U-17)
- **Context** "Outstanding" was cut to "Outstan…" on narrow phones and large text.
- **Decision** The phone tab bar shows **Dues** (`ui.nav.outstanding_short`; Hindi बकाया unchanged); the page title stays "Outstanding".

### D-012 — Members' default permissions are narrow
- **Status** Accepted · **Date** 2026-11-15 · **Decider** UX review, shipped with owner approval · **Related** [PR #516](https://github.com/DDancingDeath/bahi/pull/516) (U-09), [role-permissions.md](../role-permissions.md)
- **Decision** For shops that never saved Roles & access, Members default to **off** for profit, stock ₹ value,
  purchase rates and past cash days; saved choices are kept. The owner can change them in Settings › Team › Roles & access.
- **Confirmation** `role-access.test.js`; the defaults table in role-permissions.md.

### D-013 — PIN worker accounts are Member-only
- **Status** Accepted · **Date** 2026-11-16 · **Decider** Independent review, shipped with owner approval · **Related** [PR #520](https://github.com/DDancingDeath/bahi/pull/520), [PR #519](https://github.com/DDancingDeath/bahi/pull/519) (U-56)
- **Decision** Such accounts can only ever be Member: the Add worker picker offers Member only and role changes refuse Manager/Owner.

### D-014 — Billing: WhatsApp and Due always visible
- **Status** Accepted (merged 2026-11-22) · **Date** 2026-11-18 · **Decider** Owner (request) · **Related** [PR #534](https://github.com/DDancingDeath/bahi/pull/534)
- **Context** The UX review (U-18, U-27) hid the share button on empty bills and folded the payment rows.
- **Decision** Revert: WhatsApp share always in the footer; Cash, Online, Total paid and Due rows always shown, Wholesale included.

### D-015 — Photo of weights via Firebase AI Logic + App Check
- **Status** Accepted · **Date** 2026-11-15 · **Decider** Owner (switch is off until the owner turns it on) · **Related** #374, [photo-weights.md](../photo-weights.md), [PR #487](https://github.com/DDancingDeath/bahi/pull/487), [PR #494](https://github.com/DDancingDeath/bahi/pull/494)
- **Decision** Read handwritten weight sheets with Gemini through Firebase AI Logic (no API key in the app);
  calls require App Check (reCAPTCHA Enterprise, limited-use tokens); the user reviews before lines are added.
- **Consequences** No photo feature on a build without an App Check key.
- **Confirmation** `photo-weights.test.js`, `app-check.test.js`; review rule `no-external-ml-api`.

### D-016 — Free Spark plan, read budget, no Cloud Functions
- **Status** Accepted · **Date** 2026-11-01 (read budget recorded) · **Decider** not recorded · **Related** #159, [read-budget.md](../read-budget.md), [notifications.md](../notifications.md), [performance-budget.md](../performance-budget.md)
- **Context** Spark gives 50,000 reads and 20,000 writes a day for the whole project; the old project ran out on 2026-10-21.
- **Decision** Stay on the free plan: no Cloud Functions or triggers (they need Blaze), recent-history window
  plus stock checkpoint, per-page read baselines, session read cap and a kill switch.
- **Consequences** Every feature is judged by its reads; see the open concern in [MEMORY.md](MEMORY.md).
- **Confirmation** Read budget in `tabs-smoke.spec.js` (`tests/e2e/read-baselines.json`); `quota-guards.test.js`; nightly bench.

### D-017 — Void, never delete; owner edits recorded too
- **Status** Accepted · **Date** 2026-11-08 · **Decider** Owner (OD-13, OD-14) · **Related** #75, #121, [PR #380](https://github.com/DDancingDeath/bahi/pull/380), [role-permissions.md](../role-permissions.md)
- **Decision** Bills and expenses are voided, not deleted (only the owner deletes, and only a voided bill).
  Every money change, including the owner's, writes an edit record, a payment / write-off or a void.
- **Confirmation** `firestore.rules` + `rules-tests/test.js`; AGENTS.md §7.

### D-018 — "Overdue" = bills more than 30 days old
- **Status** Accepted · **Date** 2026-11-08 · **Decider** Owner (OD-08) · **Related** #92, [PR #389](https://github.com/DDancingDeath/bahi/pull/389), [calculations.md](../calculations.md)
- **Decision** One meaning of overdue everywhere; party lists show the total and, separately, the overdue part.

### D-019 — One stored due per bill: `payment.due`
- **Status** Accepted · **Date** 2026-11-16 · **Decider** not recorded · **Related** #126, [PR #350](https://github.com/DDancingDeath/bahi/pull/350), [PR #433](https://github.com/DDancingDeath/bahi/pull/433)
- **Decision** `payment.due` is the only stored due; legacy `dueAmount` is neither written nor read. Rules tolerate the old mirror for one release.
- **Confirmation** Review rule `due-amount-vs-payment-due-drift`; rules tests "#126 (one release)".

### D-020 — Several owners, never none
- **Status** Accepted · **Date** 2026-11-16 · **Decider** Owner (request) · **Related** [PR #525](https://github.com/DDancingDeath/bahi/pull/525), [PR #528](https://github.com/DDancingDeath/bahi/pull/528)
- **Decision** An owner can make others owner; there is always at least one owner, and the first owner is protected.
- **Confirmation** Rules tests and the owner-roles E2E.

### D-021 — Offline bill numbers per device
- **Status** Accepted · **Date** not recorded · **Decider** not recorded · **Related** #41 (Q28), [AGENTS.md §8](../../AGENTS.md)
- **Options** Pre-issued number blocks · per-device numbers.
- **Decision** Online: a transaction on a daily counter. Offline: `{prefix}{YYYYMMDD}-{device}-{seq}`, which needs no server round-trip.
- **Confirmation** Review rule `bill-numbering-count-plus-one`.

### D-022 — Oversell warns, never blocks
- **Status** Accepted · **Date** 2026-11-09 (restated) · **Decider** Owner · **Related** #59, [PR #421](https://github.com/DDancingDeath/bahi/pull/421)
- **Decision** Selling more than the stock shows warns and never blocks the bill (restated for the time
  when stock may still come from the offline cache, before the server answers).

### D-023 — Rentals: one view, no Simple / Advanced
- **Status** Accepted · **Date** 2026-11-23 · **Decider** Owner ("if we can configure everything in Simple, that should suffice") · **Related** PRs #361, #369 (the switch), [rentals-design.md §17](../rentals-design.md)
- **Context** Advanced had no capability of its own: only denser views, filters and Reports over the same data and maths.
- **Decision** One view for everyone: the Simple layout, with This month › View by (Who owes | Property | Unit), Tenants' Filter sheet
  and Moved out (N), the property screen's ⋯ (This month, Expenses), Reports always a tab, Roles & access in the page ⋯ (owner).
  The old per-phone choice is ignored and cleared; old calls open the new equivalent. No data, rules or role changes.
- **Confirmation** `rent-views-page.test.js` (every former Advanced action reachable for the same roles; old calls), E2E tabs-smoke.

### D-024 — Push while closed: Google Apps Script sends, as the project owner
- **Status** Accepted · **Date** 2026-11-23 · **Decider** Owner · **Related** #12, [notifications.md](../notifications.md) "Stage 2"
- **Options** Cloudflare Worker (free, new account, service-account key as a secret) · Cloud Functions trigger (Blaze, needs a card) · Google Apps Script under the shop's Google account.
- **Decision** Apps Script: a web app the writing phone calls with the event id (instant) plus a 5-minute sweep for offline writers. It uses the owner account's OAuth token (no key anywhere), sends with FCM v1, marks docs `pushed` and deletes stale tokens. Stays on the free plan (D-016).
- **Confirmation** `tests/push-sender/core.test.js`; rules tests "push devices" and "no client sets pushed".

### D-025 — A recurring-bill payment is one expense; everyone with the page pays
- **Status** Accepted · **Date** 2026-11-26 · **Decider** Owner (#437 (a), (b); Cash / Online always picked) · **Related** #437, #373, [calculations.md](../calculations.md) RB-12
- **Context** Phase 1 kept payments outside Money (M23 / M24 add-on), so a bill paid from the drawer left Expected cash wrong, and one also typed into Expenses counted twice.
- **Decision** Each payment saves (or links, "Already entered in Expenses") exactly one business expense, type "Bills", in the same batch, with the payment's explicit cash / online; it counts once in M4, Today and, only when cash, the drawer. M23 / M24 retired. Voiding the expense removes the payment (VOID-EXP). Older payments are not backfilled: the owner adds each with "Add to Money figures". The page is a Roles & access switch (`recurringBills`, on for managers and members); members record payments, the owner and managers keep the items.
- **Confirmation** `tests/oracle/recurring-in-money.test.js`, `linked-expense-repo.test.js`, `recurring-bills-page.test.js`, rules tests "recurring bills".

### D-026 — Worker pay is one expense too (Salaries)
- **Status** Accepted · **Date** 2026-11-26 · **Decider** Owner (#373, "same pattern" as D-025) · **Related** #373, [calculations.md](../calculations.md) WP-12
- **Context** Worker pay showed as its own Money line (M22, M25, M26) outside Expenses, so cash pay from the drawer left Expected cash wrong.
- **Decision** Each pay or advance saves (or links) exactly one business expense, type "Salaries", with the worker as the person and an explicit cash / online, in one batch; it counts once in M4, Today and, only when cash, the drawer. M22 / M25 / M26 retired. The Workers page stays owner only; only the owner creates or voids a salary expense. Salary expenses are listed in Expenses like any other. Older entries: "Add to Money figures" per entry, no backfill.
- **Confirmation** `tests/oracle/recurring-in-money.test.js` (worker pay), `workers-page.test.js`, `linked-expense-repo.test.js`, rules tests "worker pay".
