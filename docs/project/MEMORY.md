# Memory: handoff notes

> **Status:** Living, short-lived · **Owner:** whoever last worked on the repo · **Expires:** each note
> at its date. Treat everything here as **possibly stale**: check `main`, the issue or the PR before
> acting. No customer names, amounts, phone numbers or other shop data (the repo is public).
> Lasting decisions go to [DECISIONS.md](DECISIONS.md), work to [GitHub issues](TASKS.md).

**Template** — `- YYYY-MM-DD · fact or open item · evidence link · expires YYYY-MM-DD`
Replace stale lines in the PR that changes them; delete expired ones.

## Current handoff (written 2026-11-21, verified with `gh` and `main` at `4614b8a6`)

- 2026-11-16 · Cut-over done: the app lives on `bahi-happa`, tests on `bahi-happa-dev`; latest release `v1.0.0-rc16` · #72, [PR #429](https://github.com/DDancingDeath/bahi/pull/429), D-004 · expires 2026-12-05
- 2026-11-16 · UX review programme landed on `main` (batch PRs #502–#524, merged into `ux/android-review` first) · [PR #519](https://github.com/DDancingDeath/bahi/pull/519) · expires 2026-12-05
- 2026-11-22 · Billing "WhatsApp and Due always visible" revert merged (Wholesale too), v757 · [PR #534](https://github.com/DDancingDeath/bahi/pull/534), D-014 · expires 2026-12-05
- Pending owner decision **U-19**: move "Mark as cleared" / "Write off" into bill details? Not done (changes money flows) · [PR #521](https://github.com/DDancingDeath/bahi/pull/521) · expires 2026-12-05
- **U-22** settled for regular bills (2026-11-26, D-025): each payment is one expense, counted once in Money, Today and (cash only) the drawer. Worker pay still shows as its own Money line (M22) until #373 · expires 2026-12-05
- Concern (not yet measured, no issue yet): once full history is loaded, logins may re-read all bills to rebuild stock. Code does a full read whenever the stock checkpoint is missing, older than 7 days, doesn't match the items or is too large, and members (who can't rebuild) use full history (`www/js/firebase/core/stock-checkpoint.js`, [read-budget.md](../read-budget.md)). Next: measure reads per login on `bahi-happa-dev`, then file a `[Perf]` issue · expires 2026-12-05
- Dev data on `bahi-happa-dev`: state not documented in the repo (only `tools/dev/load-sample-data.js` exists) · TBD, ask owner · expires 2026-12-05
- Owner action open: device checks on the rc build · #431 · expires 2026-12-05
