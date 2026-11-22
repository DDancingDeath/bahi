# Tasks: where work is tracked

> **Status:** Living · **Owner:** Hitesh (owner) · **Last reviewed:** 2026-11-21
>
> **What this file is:** how work is listed and ordered. It is **not** a task list. GitHub issues
> are the source of truth; issue conventions are authoritative in
> [AGENTS.md §5](../../AGENTS.md#5-standard-workflows). Product scope: [PRD.md](PRD.md).

## Source of truth

| What | Where |
|---|---|
| Every bug, feature, decision, ops task | [GitHub issues](https://github.com/DDancingDeath/bahi/issues) in `DDancingDeath/bahi` (old repo's open issues moved here on 2026-10-30) |
| Pick order | Pinned issue [#172 "[Plan] Roadmap: pick order (auto-updated)"](https://github.com/DDancingDeath/bahi/issues/172) |
| Order data | [tools/plan/order.json](../../tools/plan/order.json) (phases, position, `note`, `after`) |
| Generator | [tools/plan/generate.js](../../tools/plan/generate.js), run by [plan-page.yml](../../.github/workflows/plan-page.yml) on issue changes and daily |

**Never edit #172 by hand**: its body is regenerated from `order.json` and the live issues, so a
manual edit is overwritten. There is no second checklist (no `TODO.md`, no list in this file).

## Add work

1. Search open and closed issues first.
2. Open an issue: title tag (`[Bug]`, `[Feature]`, …), one `P0`–`P3`, one `type:*`, any `area:*`,
   a milestone, and a body with problem, evidence, impact, fix, acceptance criteria.
   Label `owner-decision` if it needs the owner's answer (don't implement a guess) or
   `owner-action` for a console/secret/release step only the owner can do.
3. Place it in [tools/plan/order.json](../../tools/plan/order.json) (right phase and position) in a PR.
   Unplaced open issues appear under 🆕 Unplaced in #172.

## Pick work

Take the first open ⬜ row in #172 that isn't blocked (⛔). PRs say `Closes #N` or `Part of #N`.
A decision made along the way goes into [DECISIONS.md](DECISIONS.md) in the same PR.

## Snapshot 2026-11-21 (from `gh issue list`, may be stale)

12 open issues. With a sprint milestone:
[#101](https://github.com/DDancingDeath/bahi/issues/101) (Sprint 1 - Safety),
[#89](https://github.com/DDancingDeath/bahi/issues/89) (Sprint 2 - Trust),
[#122](https://github.com/DDancingDeath/bahi/issues/122) (Sprint 3 - Speed & offline),
[#139](https://github.com/DDancingDeath/bahi/issues/139) (Sprint 4 - Features),
[#72](https://github.com/DDancingDeath/bahi/issues/72), [#126](https://github.com/DDancingDeath/bahi/issues/126),
[#131](https://github.com/DDancingDeath/bahi/issues/131) (Later).
For the current order always use #172.
