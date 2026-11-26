# ADR-0006: Separate production and test Firebase projects, plus the dev_ prefix

- **Status:** Accepted (mirrors [D-004](../../project/DECISIONS.md#d-004--live-on-bahi-happa-test-on-bahi-happa-dev-old-projects-never-written))
- **Context:** Mistakes made during testing must never touch shop data or spend its read quota.
- **Decision:**
  - `happa.config.json` describes production (`bahi-happa`) and `config/targets/bahi-happa-dev.json` describes test.
  - CI runs `node scripts/happa-config.js target bahi-happa-dev` before `bahi-dev-deploy.yml` and PR previews.
  - At runtime, `firebaseConfig.js` also prefixes collections with `dev_` on localhost and preview-channel hosts (host contains `--`).
  - `happa-config.js guard` refuses anything that resolves to `aadhat-management`.
- **Rationale:** Real isolation between projects, without hand-kept config branches.
- **Consequences:**
  - There are two service-account secrets.
  - The rules carry duplicate `dev_*` matches.
  - Localhost uses the checked-in config, which points at **bahi-happa**, so it writes `dev_` collections in the production project (see Open Questions).
