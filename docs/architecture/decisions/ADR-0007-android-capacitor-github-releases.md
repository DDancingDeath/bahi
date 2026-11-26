# ADR-0007: Android ships as a Capacitor APK through GitHub Releases

- **Status:** Accepted (mirrors [D-003](../../project/DECISIONS.md#d-003--android--capacitor-apk-from-tagged-github-releases))
- **Context:** Field users need an installable app with Bluetooth printing and notifications. There is no Play Store account.
- **Decision:** Capacitor wraps `www/`. A `v*` tag makes `android-release.yml` build and sign `bahi.apk` and publish it as the latest GitHub Release, which `/download` links to. Manual runs publish `bahi-dev.apk` (`com.happa.dev`) as `dev-latest`. The package stays `com.happa` so installs update in place.
- **Rationale:** Full control and no store review. The same web code runs in both places.
- **Consequences:**
  - Updates reach phones through the in-app update card (`modules/app-updates.js` reads the GitHub releases API).
  - Fixes go forward only, with the `minClientVersion` gate as the brake.
  - Crashlytics and native Google sign-in work only when the `GOOGLE_SERVICES_JSON` secret is set.
