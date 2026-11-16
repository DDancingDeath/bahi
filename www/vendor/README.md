# Vendored third-party files

Served from our own origin so the service worker can precache them and the app
(PWA and Capacitor APK) can start with no network (issue #28). Do not edit these
files — replace them with a new versioned folder instead.

## Firebase JS SDK 10.7.1 (compat builds)

| File | Source | SHA-256 |
|---|---|---|
| `firebase/10.7.1/firebase-app-compat.js` | `https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js` | `af2a25c7827b5ac0eecc4e293b2644958037a4cc085ed5f5038aada31f3a4cf0` |
| `firebase/10.7.1/firebase-auth-compat.js` | `https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js` | `4e599f83d2eb9a581815a274178bf002aa517c305b85bf2489aeb5f42d26bcfb` |
| `firebase/10.7.1/firebase-firestore-compat.js` | `https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js` | `84b2e0c9480de124ed53b7206ae1a93fd5c62399e525a14bcfafc23930eaaac9` |
| `firebase/10.7.1/firebase-app-check-compat.js` | `https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check-compat.js` | `aea4ed9c48546b9d513a625de2c77b57365267b0580e0883c68ce236040f7ff2` |

- Byte-identical to the gstatic CDN copies and to the same files in the
  `firebase@10.7.1` npm package (checked via jsDelivr).
- License: Apache License 2.0, Copyright Google LLC
  (https://github.com/firebase/firebase-js-sdk/blob/master/LICENSE). The
  minified builds carry no license header of their own.
- `index.html` loads app, auth and firestore with `integrity="sha384-…"`;
  `load-perf.test.js` checks those hashes against the files on disk.
- App Check (`firebase-app-check-compat.js`) is not in `index.html`: only with a site key,
  `js/services/app-check.js` loads it after the first screen with its SRI hash
  (`APP_CHECK_SDK_INTEGRITY`, checked by `app-check.test.js`). It is in neither service
  worker list (`RUNTIME_ONLY` in `scripts/check-sw-assets.js`), so phones without a key
  never download it; the fetch handler caches it on first use.

### Upgrading

1. Download the `*-compat.js` files for the new version into
   `vendor/firebase/<version>/` and verify them against the npm package.
2. Update the `<script>` tags (src + integrity) in `index.html`, `APP_CHECK_SDK_URL` /
   `APP_CHECK_SDK_INTEGRITY` in `js/services/app-check.js` (and re-check that the SDK still
   reuses an existing `self.grecaptcha`, `app-check.test.js`), `RUNTIME_ONLY` in
   `scripts/check-sw-assets.js` and the `STATIC_ASSETS` entries in `service-worker.js`;
   delete the old folder.
3. Run `npm run check:sw` and `npm test`.

## Firebase JS SDK 13.2.0 (modular ESM, Firebase AI Logic only)

| File | Source | SHA-256 of the npm / gstatic file | SHA-256 here |
|---|---|---|---|
| `firebase/13.2.0/firebase-app.js` | `https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js` | `a67a49aeb0937561e6405f721cf486dc3085e73763716e8233082417be769d40` | the same (unchanged) |
| `firebase/13.2.0/firebase-ai.js` | `https://www.gstatic.com/firebasejs/13.2.0/firebase-ai.js` | `0124274db8ef2c4e30014218bbf0e99bf6daa89e92d963931a11f2284bf54743` | `14faa220152709892c09a3c6819580c4e87ce43625e7fd2c37295022d0590263` |
| `firebase/13.2.0/firebase-app-check.js` | `https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js` | `310b32bd758d7b70b3c5de3dd5a5bf355d69583355bbf21315d608c0f3259a87` | `f82bfa8484550dbf4666335d6477b60bc6bb123145dc5d748dd1a83167f1d187` |

- Used only by photo of weights (#374, `js/firebase/photo-weights-ai.js`): Firebase AI Logic exists only
  as the modular `firebase/ai` (there is no compat build), so it runs as a second, separate Firebase app.
  The rest of the app keeps the 10.7.1 compat SDK.
- The gstatic files equal the same files in the `firebase@13.2.0` npm package (checked via jsDelivr).
  The only edit: in `firebase-ai.js` and `firebase-app-check.js` the one import
  `from"https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js"` is rewritten to `from"./firebase-app.js"`,
  so they load from our origin (CSP `script-src 'self'`) and share one `firebase-app.js`.
- Imported with `import()` on the first photo, so there is no SRI. They are in neither service worker list
  (`RUNTIME_ONLY` in `scripts/check-sw-assets.js`): phones that never use the feature never download them.
- License: Apache License 2.0, Copyright Google LLC.

## SheetJS Community Edition 0.20.1 (`xlsx.mini.min.js`)

| File | Source | SHA-256 |
|---|---|---|
| `sheetjs/0.20.1/xlsx.mini.min.js` | `https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.mini.min.js` | `c2721014c290bbfee3b7fcf9998da38372d4d568c0706428d881323d8af0d1c9` |

- The small build (XLSX / CSV only) of the same release Items loads in full from
  the CDN (`XLSX_URL` in `js/utils/lazy-scripts.js`, whose SRI hash matched the
  downloaded full build). Excel files saved through `Exporter.saveWorkbook`
  (Ask item reports) use this copy, so they work offline (#415).
- In `LAZY_ASSETS` of `service-worker.js` (not precached; install caches it,
  best effort). `lazy-scripts.js` loads it with `integrity="sha384-…"`
  (`XLSX_WRITER_INTEGRITY`); `load-perf.test.js` checks it against the file.
- License: Apache License 2.0, Copyright SheetJS LLC
  (https://git.sheetjs.com/sheetjs/sheetjs/src/branch/master/LICENSE).
