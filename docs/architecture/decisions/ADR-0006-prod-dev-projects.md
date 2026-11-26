# ADR-0006: Separate production and test Firebase projects, plus the dev_ prefix

- **Status:** Accepted. History: [D-004](../../project/DECISIONS.md#d-004--live-on-bahi-happa-test-on-bahi-happa-dev-old-projects-never-written).
- **Context:** Hosted tests and PR previews need separation from production data and quota. Localhost still defaults to the production project.
- **Decision:**
  - **The build target picks the project.** `happa.config.json` targets production; CI rebuilds for `bahi-happa-dev` for the test deploy and PR previews. A guard refuses the archived project.
  - **Runtime picks the collection prefix.** By default it is `dev_` on browser localhost and preview channels, and none elsewhere. A URL parameter or a saved setting can override it.
- **Rationale:** Separate projects isolate hosted test data and quota; collection prefixes alone do not.
- **Consequences:**
  - There are two deploy identities.
  - The rules repeat their matches for `dev_` collections.
  - Localhost uses the checked-in production config, so it writes `dev_` collections in the production project.