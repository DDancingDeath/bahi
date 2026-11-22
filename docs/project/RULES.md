# Rules index

> **Status:** Living index · **Owner:** Hitesh (owner) · **Last reviewed:** 2026-11-21
>
> **What this file is:** a map, not a rulebook. Each row says *where* a group of rules lives and
> what it covers; the linked file is authoritative and wins over anything here. Never copy a rule
> into this file; add a row that points to its home. Agent rules: [AGENTS.md](../../AGENTS.md).
> Decisions and their reasons: [DECISIONS.md](DECISIONS.md).

## Repo-wide and agent rules

| Rule group | Authoritative home | What lives there |
|---|---|---|
| Unbreakable rules | [AGENTS.md §2](../../AGENTS.md#2-the-unbreakable-rules) | Production care, data access only through `FirebaseService` / repositories, no build step, no casual renames, `npm ci`, money care, no secrets |
| Code conventions | [AGENTS.md §4](../../AGENTS.md#4-codebase-orientation-the-bits-youll-get-wrong) | Handlers, templates, CSS build, dates, escaping, i18n, cache bump, versions, offline/saving, state, Rentals loading |
| Issues, plan, PRs, CI | [AGENTS.md §5](../../AGENTS.md#5-standard-workflows) | Issue titles/labels/milestones, pick order, releasing, CI jobs, PR checklist |
| Firestore rules workflow | [AGENTS.md §7](../../AGENTS.md#7-firestore-rules--reminder) | Edit → rules tests → deploy order; edit window, void-not-delete, owner records |
| Common pitfalls | [AGENTS.md §8](../../AGENTS.md#8-common-pitfalls) | Mistakes agents keep making |
| Regex review rules | [.github/review-rules.yml](../../.github/review-rules.yml) | Patterns `npm run check:review` blocks on added lines |
| PR template | [.github/pull_request_template.md](../../.github/pull_request_template.md) | What every PR states |

## Data, money and permissions

| Rule group | Authoritative home | What lives there |
|---|---|---|
| Who may read/write what | [firestore.rules](../../firestore.rules) | The enforced permission model (tests: [rules-tests/test.js](../../rules-tests/test.js)) |
| Rules commentary, CSP, App Check, secrets | [security.md](../security.md) | Why the rules look as they do, headers/CSP, innerHTML audit, Android notes |
| Roles and permission defaults | [role-permissions.md](../role-permissions.md) | Owner / manager / member / rentals roles, Roles & access ids, edit window, voids |
| Every number on screen | [calculations.md](../calculations.md) | Plain-language definition and spec ID per figure, rounding, money/kg text |
| Layers and refactor order | [ARCHITECTURE.md](ARCHITECTURE.md) | calc → services → repositories → UI; architecture guard |
| Un-awaited async calls | [async-audit.md](../async-audit.md) | Audit and the floating-promises guard |

## UI, language and pages

| Rule group | Authoritative home | What lives there |
|---|---|---|
| Design system | [design-system.md](../design-system.md) | Tokens, components, icons, themes, allow-listed exceptions |
| Words (en + hi) | [glossary.md](../glossary.md) | One word per idea in both languages |
| Page behaviour | [pages/](../pages/) | One doc per page, English and Hindi (spec IDs must match) |
| Printing | [printing.md](../printing.md), [desktop-printing.md](../desktop-printing.md) | Raster-only receipts; desktop printing spike |

## Performance, cost and release

| Rule group | Authoritative home | What lives there |
|---|---|---|
| Firestore reads (free plan) | [read-budget.md](../read-budget.md) | Daily quota, per-page read baselines, guards, kill switch |
| Speed budgets | [performance-budget.md](../performance-budget.md) | Start-up and page budgets, nightly bench gate |
| Cached-first start-up (design) | [startup-cached-first.md](../startup-cached-first.md) | Design for showing the first screen from the phone's cache |
| Error reporting | [error-reporting.md](../error-reporting.md) | How errors and crashes are reported (free tools only) |
| Releasing | [release-checklist.md](../release-checklist.md) | Manual checks before and after a release tag |
| Go-live / projects | [happa-go-live.md](../happa-go-live.md) | Which Firebase project is which, cut-over steps |
