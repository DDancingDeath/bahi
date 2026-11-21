---
name: decision-record
description: 'Add or update a decision in docs/DECISIONS.md (lightweight ADR, IDs D-NNN) for Bahi (happa). Use when a PR makes, reverses or questions a consequential choice: stack, data model, money, permissions, names the shop sees, cost.'
license: Apache-2.0
---

# Decision record (Bahi)

Writes one entry in [docs/DECISIONS.md](../../../docs/DECISIONS.md). The log records *why*; the rule
itself stays in its authoritative home ([docs/RULES.md](../../../docs/RULES.md), [AGENTS.md](../../../AGENTS.md)).

## When

- A PR makes or changes a hard-to-reverse choice, or the owner answers an `owner-decision` issue.
- Not for routine fixes. If the decision isn't made yet, add it as `Proposed`.

## Steps

1. Read docs/DECISIONS.md: reuse an existing entry if it is the same decision.
2. Gather evidence: the PR, issue, owner comment or file that shows the decision. No evidence → `Proposed`.
3. Take the next free ID (`D-NNN`, never reused) and add a row to the Index table.
4. Write the entry (≤ ~15 lines):

```markdown
### D-NNN — <short title>
- **Status** Proposed | Accepted | Superseded by D-NNN | Deprecated · **Date** YYYY-MM-DD · **Decider** <who, or "not recorded"> · **Related** <issues, PRs, docs>
- **Context** <forces at play, 1–2 lines>
- **Options** <A · B · C, one line each with the main trade-off>
- **Decision** <what was chosen>
- **Consequences** <what gets easier / harder / to revisit>
- **Confirmation** <test, guard or check that keeps it true>
```

5. Reversing a decision: add a new entry and set the old one to `Superseded by D-NNN`; never delete.
6. Same PR: update the authoritative home if the rule changed, and drop any MEMORY.md line it settles.
7. Run `npx jest tests/ci/docs-links.test.js`.

## Tips

- Name the options even when one is obvious; include cost (Spark reads), offline and Hindi effects.
- ISO dates, relative links, `TBD` / `not recorded` instead of guesses, no shop data (public repo).

---

Adapted from the `architecture` skill in [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/blob/2d6f7e22dd25593f0f748010430ef86f19659735/engineering/skills/architecture/SKILL.md)
(commit `2d6f7e2`, published by Anthropic; the upstream LICENSE names no other copyright holder), licensed under the
[Apache License, Version 2.0](LICENSE) (copy of the upstream LICENSE next to this file).
**Modified:** rewritten from an ADR/system-design command into a skill that writes entries in this
repo's lightweight decision log. The upstream repository had no `NOTICE` file when this was
copied (2026-11-21); if one is added, its attribution notices must be kept here. Distributed on an
"AS IS" basis, without warranties or conditions of any kind.
