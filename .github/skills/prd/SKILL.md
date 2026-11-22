---
name: prd
description: 'Write or update the product requirements for Bahi (happa): docs/project/PRD.md or one feature section in the same format. Use when asked to "write a PRD", "document requirements" or "plan a feature" in this repo.'
license: MIT
---

# PRD (Bahi)

Produces or updates [docs/project/PRD.md](../../../docs/project/PRD.md), or a feature section in its format.
The PRD says *what and why* in 1–2 pages; it links to the authoritative homes and never copies
them (rules: [docs/project/RULES.md](../../../docs/project/RULES.md); agent rules: [AGENTS.md](../../../AGENTS.md)).

## Workflow

1. **Discovery.** Read docs/project/PRD.md, the related [docs/pages/](../../../docs/pages/) doc, the GitHub
   issue and [docs/project/DECISIONS.md](../../../docs/project/DECISIONS.md). Ask the owner at least 2 questions when
   the problem, success measure or constraints are unclear. Never guess: write `TBD`.
2. **Scope.** Map the user flow for each role (owner, manager, member, Rentals helper;
   [docs/role-permissions.md](../../../docs/role-permissions.md)). Write non-goals.
3. **Draft** in the schema below, then ask the owner to review specific sections.

## Schema (keep these headings)

1. **Purpose** — problem (1–2 sentences) and the solution.
2. **Users and roles** — table: user, what they do, notes.
3. **Key jobs** — numbered, each linking its page doc.
4. **Outcomes** — table: outcome, measure, target (`TBD` when the owner hasn't set one).
5. **Core requirements** — table by area, each row linking its detailed home or issue.
6. **Non-goals.**
7. **Constraints** — phones ~360–412 px, Hindi/English, patchy network, free Spark plan, real shop in production.
8. **Open questions** — each linked to an issue, PR or MEMORY.md line.

A feature section uses the same headings one level lower, plus **Acceptance criteria**
(checkboxes that become the issue's acceptance criteria).

## Quality bar

- Concrete and checkable: "a page reads ≤ its baseline + 25%", not "fast".
- Header keeps `Status: Draft` until the owner approves; ISO dates; relative links.
- No shop data (names, amounts, phone numbers): the repo is public.
- A choice made while writing goes to docs/project/DECISIONS.md (skill `decision-record`).
- Run `npx jest tests/ci/docs-links.test.js` after editing.

---

Adapted from the `prd` skill in [github/awesome-copilot](https://github.com/github/awesome-copilot/blob/03986ae177602317067149832a73afec7bacb3dc/skills/prd/SKILL.md)
(commit `03986ae`). Copyright GitHub, Inc. Licensed under the MIT License. Changes: trimmed and
rewritten for this repo's PRD format. Licence notice, as required:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
