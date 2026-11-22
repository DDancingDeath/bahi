# Project docs

The repo-wide "what, why and how we work" docs. Feature and page docs stay in [docs/](../);
agent rules stay in [AGENTS.md](../../AGENTS.md), which wins over anything here.

| File | What it is for | Who updates it | Authority |
|---|---|---|---|
| [PRD.md](PRD.md) | What the product is and why: users, scope, goals, open questions | Owner (agents draft via skill `prd`) | Draft until the owner approves it |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, which function owns each number, refactor plan, ratchet | The PR that moves a layer or a number's owner | Authoritative for layers; numbers are defined in [calculations.md](../calculations.md) |
| [RULES.md](RULES.md) | Index of where each group of rules lives | Any PR that adds or moves a rule's home | A map only; the linked file wins |
| [DECISIONS.md](DECISIONS.md) | Log of decisions made and why (D-NNN) | The PR that makes or reverses a decision (skill `decision-record`) | Records the why; the rule stays in its home |
| [TASKS.md](TASKS.md) | How work is tracked and ordered | Owner, when the process changes | GitHub issues are the source of truth |
| [MEMORY.md](MEMORY.md) | Short-lived handoff notes between sessions | Whoever last worked on the repo | Possibly stale; never authoritative |
