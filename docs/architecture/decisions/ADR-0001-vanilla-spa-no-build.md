# ADR-0001: Vanilla ES-module SPA, no build step or framework

- **Status:** Accepted (mirrors [D-001](../../project/DECISIONS.md#d-001--no-build-step-or-framework))
- **Context:** The app runs on low-end Android phones and in browsers. One small team maintains it. Whatever is in `www/` must be exactly what phones run.
- **Decision:** Plain ES modules with no bundler, no framework and no TypeScript sources. `www/index.html` loads the vendored Firebase compat SDK, `firebaseConfig.js` and then `js/main.js`. `main.js` wires the page modules onto the `window.app` facade. Markup calls them through delegated `data-on*` attributes (`ui/actions.js`).
- **Rationale:** No build to break, easy debugging on a phone, and the same files work for the website and the Capacitor APK.
- **Consequences:** There is no tree-shaking, so start-up weight is managed with lazy `import()`, `template-loader.js` and the service-worker precache budget. Renaming a file or method can break string references, so AGENTS.md rule 4 applies. The guards are `framework-import` and `ts-file-introduced` in `review-rules.yml` and `inline-handlers.test.js`.
