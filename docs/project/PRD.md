# Product requirements: Bahi

> **Status:** Draft (becomes Approved only after the owner reviews it) · **Owner:** Hitesh (owner) ·
> **Last reviewed:** 2026-11-21
>
> **What this file is:** the one-page "what and why" of the product. It links to the detailed
> homes and never restates them: how each page behaves is in [pages/](../pages/), numbers in
> [calculations.md](../calculations.md), permissions in [role-permissions.md](../role-permissions.md),
> rules in [RULES.md](RULES.md), decisions in [DECISIONS.md](DECISIONS.md), work in
> [GitHub issues](TASKS.md). Unknown targets say TBD.

## 1. Purpose

**Bahi** (brand **happa**) is the billing and bookkeeping app of a small Indian grain shop (an
*aadhat*): buying produce, selling it retail and wholesale, tracking stock, dues (udhaar) and the
cash drawer, plus a separate **Rentals** business for the owner's properties. It succeeds the
older AadhatManagementApp. It runs as a website and an Android app on the same
Firebase project ([ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md) D-003, D-004).

## 2. Users and roles

| User | What they do | Notes |
|---|---|---|
| Owner | Everything; sets roles and what each role may see | Several owners allowed, never none (D-020) |
| Manager | Runs the shop day to day: bills, rates, stock, dues, reports | Defaults in [role-permissions.md](../role-permissions.md) |
| Member (worker) | Enters bills at the counter; sees only what the owner allows | Narrow defaults (D-012); PIN accounts are Member-only (D-013) |
| Rentals helper | Works only in Rentals (`rentRole`) | Rentals-only users never see Aadhat data |

Shop workers at the counter are the main users; the owner is the main reader of reports.

## 3. Key jobs

1. Make a purchase, retail or wholesale bill quickly, print or share it ([billing](../pages/billing.md)).
2. Know today's sales, cash and what's due ([today](../pages/today.md), [cash](../pages/cash.md)).
3. Track and collect dues per party ([outstanding](../pages/outstanding.md)).
4. Keep rates and stock right ([rates](../pages/rates.md), [stock](../pages/stock.md)).
5. Record spending, worker pay and regular bills ([expenses](../pages/expenses.md), [workers](../pages/workers.md), [recurring](../pages/recurring.md)).
6. See profit, statements and trends ([money](../pages/money.md), [statements](../pages/statements.md), [insights](../pages/insights.md), [ask](../pages/ask.md)).
7. Run Rentals: tenants, rent, receipts, deposits ([rentals](../pages/rentals.md), [rentals-design.md](../rentals-design.md)).

## 4. Outcomes

| Outcome | Measure | Target |
|---|---|---|
| Bills are never lost or double-saved | Failed / duplicate saves (App health) | TBD |
| Numbers are right | Number checks and audit mismatches ([calculations.md](../calculations.md)) | 0 known mismatches |
| Fast on shop phones | [performance-budget.md](../performance-budget.md) | As set there |
| Stays on the free plan | Daily reads vs 50,000 ([read-budget.md](../read-budget.md)) | Under 50% of quota (doc target) |
| Workers can use it without help | TBD | TBD |

## 5. Core requirements (by area)

| Area | Requirement | Detail |
|---|---|---|
| Billing | One tap = one write; works offline; never shows "Saved" for a refused write | [AGENTS.md §4](../../AGENTS.md), [billing](../pages/billing.md), [voice-billing.md](../voice-billing.md), [photo-weights.md](../photo-weights.md) |
| Money | One stored due per bill; void, never delete; every edit recorded | D-017, D-019, [role-permissions.md](../role-permissions.md) |
| Numbers | Every figure has a spec ID and one home page | [calculations.md](../calculations.md) |
| Access | Owner-set roles enforced by rules | [firestore.rules](../../firestore.rules), [role-permissions.md](../role-permissions.md) |
| Parties | Stable customer/supplier ids, merge duplicates | [parties-design.md](../parties-design.md), #139 |
| Language | Hindi or English, one at a time; same words everywhere | [glossary.md](../glossary.md), D-008 |
| UI | Design-system tokens, 48 px targets, AA contrast | [design-system.md](../design-system.md) |
| Printing and sharing | Bluetooth receipt printer, WhatsApp share | [printing.md](../printing.md) |
| Notifications | In-app bell; phone reminders in the APK | [notifications.md](../notifications.md) |
| Security | Enforced CSP, App Check, no secrets in the repo | [security.md](../security.md), #89 |

## 6. Non-goals

- No bundler, framework or server code (Cloud Functions) ([DECISIONS.md](DECISIONS.md) D-001, D-016).
- No paid Firebase plan for now (D-016).
- No old bills before the cut-over inside the app (D-006).
- No changes to the old app or its project (D-004).

## 7. Constraints

- Phones about 360–412 px wide (owner brief; phone layout checked at ≈ 390 px) and large text.
- Hindi or English, chosen per device; the screen shows one language at a time.
- Patchy network: offline first, writes queue and sync ([startup-cached-first.md](../startup-cached-first.md)).
- Free Spark plan: 50,000 reads and 20,000 writes a day for the whole project ([read-budget.md](../read-budget.md)).
- Real shop in production: small, reversible changes ([AGENTS.md §2](../../AGENTS.md)). The repo is public: no shop data.

## 8. Open questions

| Question | Where |
|---|---|
| Does worker pay also count in Expenses / Spending? (Regular bills do: one expense per payment, D-025 in [DECISIONS.md](DECISIONS.md)) | #373, U-22 in [MEMORY.md](MEMORY.md) |
| Where do "Mark as cleared" / "Write off" live (list or bill details)? | U-19 in [MEMORY.md](MEMORY.md) |
| Read cost once full history is loaded | [MEMORY.md](MEMORY.md), [read-budget.md](../read-budget.md) |
| Outcome targets marked TBD above | Owner |
