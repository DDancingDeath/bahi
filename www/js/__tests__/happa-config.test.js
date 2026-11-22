/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, loadTarget, withTarget, derive, configProblems, hostingProblems, plan, check, guard } = require('../../../scripts/happa-config.js');

const ROOT = path.join(__dirname, '..', '..', '..');

const filled = () => {
    const raw = JSON.parse(JSON.stringify(loadConfig(ROOT)));
    Object.assign(raw.firebase, {
        projectId: 'happa-shop',
        hostingSite: '',
        redirectHostingSites: [],
        apiKey: 'AIzaTestKey',
        messagingSenderId: '123',
        appId: '1:123:web:abc'
    });
    raw.ownerConfirmed = true;
    return raw;
};

describe('happa.config.json', () => {
    test('every identity file matches happa.config.json', () => {
        expect(check(ROOT, { syncOnly: true })).toEqual([]);
    });

    test('release gate lists unfilled placeholders and the owner confirmation', () => {
        const raw = loadConfig(ROOT);
        raw.firebase.projectId = '__HAPPA_PROJECT_ID__';
        raw.ownerConfirmed = false;
        const problems = configProblems(raw).join('\n');
        expect(problems).toMatch(/firebase\.projectId = __HAPPA_PROJECT_ID__/);
        expect(problems).toMatch(/ownerConfirmed/);
        expect(configProblems(filled())).toEqual([]);
    });

    test('the derived Firebase config uses the .firebasestorage.app bucket and no Analytics SDK is loaded', () => {
        const d = derive(loadConfig(ROOT));
        expect(d.webConfig.storageBucket).toBe(`${d.projectId}.firebasestorage.app`);
        const index = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
        expect(index).not.toMatch(/firebase-analytics|googletagmanager|gtag\(/i);
        expect(fs.existsSync(path.join(ROOT, 'www', 'vendor', 'firebase', '10.7.1', 'firebase-analytics-compat.js'))).toBe(false);
    });

    test('the old app project and package are refused', () => {
        const oldProject = filled();
        oldProject.firebase.projectId = 'aadhat-management';
        expect(configProblems(oldProject).join('\n')).toMatch(/old app/);
        const oldPackage = filled();
        oldPackage.androidPackage = 'com.hitesh.aadhat';
        expect(configProblems(oldPackage).join('\n')).toMatch(/old app/);
    });

    test('filled values reach every identity file', () => {
        const files = Object.fromEntries(plan(ROOT, filled()).map((p) => [p.file, p.wanted]));
        for (const [file, text] of Object.entries(files)) {
            expect({ file, placeholder: /__HAPPA_[A-Z_]+__/.test(text) }).toEqual({ file, placeholder: false });
            expect({ file, old: /aadhat-management|applicationId "com\.hitesh|"appId": "com\.hitesh|>com\.hitesh\.aadhat</.test(text) }).toEqual({ file, old: false });
        }
        expect(JSON.parse(files['.firebaserc']).projects.default).toBe('happa-shop');
        expect(JSON.parse(files['firebase.json']).hosting.site).toBe('happa-shop');
        expect(files['www/firebaseConfig.js']).toContain('"authDomain": "happa-shop.firebaseapp.com"');
        expect(files['www/download.html']).toContain('href="https://happa-shop.web.app"');
        expect(files['www/download.html']).toContain('releases/latest/download/bahi.apk');
        expect(files['android/app/build.gradle']).toMatch(/applicationId "com\.happa"/);
        expect(files['android/app/build.gradle']).toMatch(/namespace "com\.happa"/);
        // A new project moves the CSP's Auth frame with it (Google sign-in, docs/google-sign-in.md)
        const appCsp = JSON.parse(files['firebase.json']).hosting.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
        expect(appCsp).toContain("frame-src 'self' https://happa-shop.firebaseapp.com https://www.google.com/recaptcha/;");
        expect(appCsp).not.toContain('happa-bfc07');
    });

    test('Google sign-in is off unless switched on, per platform, from happa.config.json', () => {
        const off = Object.fromEntries(plan(ROOT, filled()).map((p) => [p.file, p.wanted]));
        expect(off['www/js/config/app-identity.js']).toContain('"googleSignIn": {\n        "web": false,\n        "android": false\n    }');
        expect(off['www/firebaseConfig.js']).toContain('const googleSignInWeb = false;\n// </happa-config>');

        const raw = filled();
        raw.googleSignIn = { web: true, android: false };
        const on = Object.fromEntries(plan(ROOT, raw).map((p) => [p.file, p.wanted]));
        expect(on['www/firebaseConfig.js']).toContain('const googleSignInWeb = true;');
        expect(derive(raw).googleSignIn).toEqual({ web: true, android: false });
        expect(configProblems(raw)).toEqual([]);

        delete raw.googleSignIn;
        expect(derive(raw).googleSignIn).toEqual({ web: false, android: false });
        raw.googleSignIn = { web: 'yes' };
        expect(configProblems(raw).join('\n')).toMatch(/googleSignIn must be/);
        raw.googleSignIn = { ios: true };
        expect(configProblems(raw).join('\n')).toMatch(/googleSignIn must be/);
    });

    test('App Check (#89) is off without a site key; appCheck.siteKey reaches firebaseConfig.js', () => {
        const offRaw = filled();
        offRaw.appCheck = { siteKey: '' };
        const off = Object.fromEntries(plan(ROOT, offRaw).map((p) => [p.file, p.wanted]));
        expect(off['www/firebaseConfig.js']).toContain('const appCheckSiteKey = "";');
        const raw = filled();
        delete raw.appCheck;
        expect(derive(raw).appCheckSiteKey).toBe('');
        expect(configProblems(raw)).toEqual([]);
        raw.appCheck = { siteKey: ' 6LcTestKey_-abc ' };
        const on = Object.fromEntries(plan(ROOT, raw).map((p) => [p.file, p.wanted]));
        expect(on['www/firebaseConfig.js']).toContain('const appCheckSiteKey = "6LcTestKey_-abc";');
        expect(configProblems(raw)).toEqual([]);
        raw.appCheck = { siteKey: '"; alert(1); "' };
        expect(configProblems(raw).join('\n')).toMatch(/appCheck must be/);
        raw.appCheck = { enforce: true };
        expect(configProblems(raw).join('\n')).toMatch(/appCheck must be/);
    });

    test('only the app site serves www/; redirect sites only 301 every path to it', () => {
        const raw = filled();
        raw.firebase.hostingSite = 'happa-app';
        raw.firebase.redirectHostingSites = ['happa-shop'];
        const d = derive(raw);
        const files = Object.fromEntries(plan(ROOT, raw).map((p) => [p.file, p.wanted]));
        const json = JSON.parse(files['firebase.json']);
        expect(json.hosting.map((h) => [h.site, h.public])).toEqual([['happa-app', 'www'], ['happa-shop', 'hosting-redirect']]);
        expect(json.hosting[0].redirects).toBeUndefined();
        expect(json.hosting[1]).toEqual({ site: 'happa-shop', public: 'hosting-redirect',
            redirects: [
                { source: '/', destination: 'https://happa-app.web.app/', type: 301 },
                { source: '/:path*', destination: 'https://happa-app.web.app/:path', type: 301 }
            ],
            headers: [{ source: '**', headers: expect.arrayContaining([{ key: 'X-Frame-Options', value: 'DENY' }]) }] });
        expect(hostingProblems(json, d)).toEqual([]);
        expect(files['www/download.html']).toContain('href="https://happa-app.web.app"');
        expect(configProblems(raw)).toEqual([]);

        const appOnRedirectSite = JSON.parse(files['firebase.json']);
        appOnRedirectSite.hosting[1] = { ...appOnRedirectSite.hosting[0], site: 'happa-shop' };
        expect(hostingProblems(appOnRedirectSite, d).join('\n')).toMatch(/happa-shop must only 301/);
        const redirectedApp = JSON.parse(files['firebase.json']);
        redirectedApp.hosting[0].redirects = redirectedApp.hosting[1].redirects;
        expect(hostingProblems(redirectedApp, d).join('\n')).toMatch(/happa-app must serve the app/);
        expect(hostingProblems({ hosting: json.hosting[0] }, d).join('\n')).toMatch(/must be \[happa-app, happa-shop\]/);

        raw.firebase.redirectHostingSites = ['aadhat-management'];
        expect(configProblems(raw).join('\n')).toMatch(/old app/);
    });
});

describe('CI guard', () => {
    let dir;
    const write = (projectId, rc = projectId) => {
        const raw = filled();
        raw.firebase.projectId = projectId;
        fs.writeFileSync(path.join(dir, 'happa.config.json'), JSON.stringify(raw));
        fs.writeFileSync(path.join(dir, '.firebaserc'), JSON.stringify({ projects: { default: rc } }));
        const hosting = plan(ROOT, raw).find((p) => p.file === 'firebase.json').wanted;
        fs.writeFileSync(path.join(dir, 'firebase.json'), hosting);
    };
    const sa = (projectId) => JSON.stringify({ project_id: projectId });

    beforeEach(() => { dir = fs.mkdtempSync(path.join(ROOT, '.happa-test-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test('passes for the Happa project with a matching service account', () => {
        write('happa-shop');
        expect(guard(dir, { requireReady: true, requireSa: true, saJson: sa('happa-shop') })).toMatchObject({ ok: true, ready: true, projectId: 'happa-shop' });
    });

    test('never lets aadhat-management through', () => {
        write('aadhat-management');
        expect(guard(dir, { saJson: sa('aadhat-management') }).ok).toBe(false);
        write('happa-shop', 'aadhat-management');
        expect(guard(dir, { saJson: sa('happa-shop') }).ok).toBe(false);
        write('happa-shop');
        expect(guard(dir, { saJson: sa('aadhat-management') }).ok).toBe(false);
    });

    test('fails when firebase.json gives the app to a redirect site', () => {
        write('happa-shop');
        const json = JSON.parse(fs.readFileSync(path.join(dir, 'firebase.json'), 'utf8'));
        json.hosting = [json.hosting, { ...json.hosting, site: 'happa-old' }];
        const raw = JSON.parse(fs.readFileSync(path.join(dir, 'happa.config.json'), 'utf8'));
        raw.firebase.redirectHostingSites = ['happa-old'];
        fs.writeFileSync(path.join(dir, 'happa.config.json'), JSON.stringify(raw));
        fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify(json));
        expect(guard(dir, { saJson: sa('happa-shop') }).ok).toBe(false);
    });

    test('placeholder project: previews skip, deploys fail', () => {
        write('__HAPPA_PROJECT_ID__');
        expect(guard(dir, { saJson: sa('happa-shop') })).toMatchObject({ ok: true, ready: false });
        expect(guard(dir, { requireReady: true, saJson: sa('happa-shop') }).ok).toBe(false);
    });

    test('missing service account: previews skip, deploys fail', () => {
        write('happa-shop');
        expect(guard(dir, {})).toMatchObject({ ok: true, ready: false });
        expect(guard(dir, { requireSa: true }).ok).toBe(false);
    });

    test('derived URLs come from the project id unless a hosting site is set', () => {
        const raw = filled();
        expect(derive(raw).downloadPageUrl).toBe('https://happa-shop.web.app/download');
        raw.firebase.hostingSite = 'happa-app';
        expect(derive(raw).siteUrl).toBe('https://happa-app.web.app');
    });
});

describe('Android build target (config/targets)', () => {
    const workflow = (name) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
    const bahi = () => withTarget(loadConfig(ROOT), loadTarget('bahi-happa', ROOT));

    test('the web deploy is bahi-happa; dev deploys and previews build for bahi-happa-dev; no workflow reaches happa-bfc07', () => {
        expect(derive(loadConfig(ROOT))).toMatchObject({ projectId: 'bahi-happa', hostingSite: 'bahi-happa', redirectSites: [] });
        expect(JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default).toBe('bahi-happa');
        for (const name of ['firebase-hosting-merge.yml', 'firestore-rules-deploy.yml']) {
            expect({ name, target: /happa-config\.js target|config\/targets/.test(workflow(name)) }).toEqual({ name, target: false });
            expect(workflow(name)).toContain('secrets.FIREBASE_SERVICE_ACCOUNT_BAHI_HAPPA }}');
        }
        for (const name of fs.readdirSync(path.join(ROOT, '.github', 'workflows'))) {
            expect({ name, legacy: workflow(name).includes('FIREBASE_SERVICE_ACCOUNT_HAPPA }}') }).toEqual({ name, legacy: false });
        }
        // The dev deploy, PR previews and their channel clean-up run on the test project only, with its own key.
        const dev = workflow('bahi-dev-deploy.yml');
        expect(dev.indexOf('target bahi-happa-dev')).toBeLessThan(dev.indexOf('guard --require-ready --require-sa --sa-env SA_JSON'));
        expect(dev).toContain('secrets.FIREBASE_SERVICE_ACCOUNT_BAHI_HAPPA_DEV }}');
        expect(dev).not.toContain('secrets.FIREBASE_SERVICE_ACCOUNT_BAHI_HAPPA }}');
        const preview = workflow('firebase-hosting-pull-request.yml');
        expect(preview.match(/node scripts\/happa-config\.js target bahi-happa-dev/g)).toHaveLength(2);
        expect(preview).not.toContain('FIREBASE_SERVICE_ACCOUNT_HAPPA }}');
        expect(preview.indexOf('target bahi-happa-dev')).toBeGreaterThan(preview.indexOf('run: npm test'));
        expect(preview.indexOf('target bahi-happa-dev')).toBeLessThan(preview.indexOf('guard --sa-env SA_JSON'));
        const android = workflow('android-release.yml');
        expect(android).toContain("TARGET: ${{ inputs.target || 'bahi-happa' }}");
        const at = (s) => android.indexOf(s);
        expect(at('node scripts/happa-config.js target "$TARGET"')).toBeGreaterThan(at('run: npx jest --ci'));
        expect(at('node scripts/happa-config.js target "$TARGET"')).toBeLessThan(at('node scripts/release-notes.js'));
        expect(at('node scripts/happa-config.js target "$TARGET"')).toBeLessThan(at('run: npx cap sync android'));
        // bahi.apk from rc15; the same file stays published as happa.apk for old links and bookmarks
        expect(derive(loadConfig(ROOT)).apkDownloadUrl).toBe('https://github.com/DDancingDeath/bahi/releases/latest/download/bahi.apk');
        expect(android).toContain('cp android/app/build/outputs/apk/release/app-release.apk dist/happa.apk');
        expect(android).toContain('files+=("dist/happa.apk")');
    });

    test('bahi-happa reaches every bundled file, with nothing left of happa-bfc07', () => {
        const raw = bahi();
        expect(configProblems(raw)).toEqual([]);
        expect(derive(raw)).toMatchObject({
            projectId: 'bahi-happa', siteUrl: 'https://bahi-happa.web.app', downloadPageUrl: 'https://bahi-happa.web.app/download',
            androidPackage: 'com.happa', apkFile: 'bahi.apk', googleSignIn: loadConfig(ROOT).googleSignIn
        });
        expect(derive(raw).webConfig).not.toHaveProperty('measurementId');
        const files = Object.fromEntries(plan(ROOT, raw).map((p) => [p.file, p.wanted]));
        expect(files['www/firebaseConfig.js']).toContain('"projectId": "bahi-happa"');
        expect(files['www/js/config/app-identity.js']).toContain('"siteUrl": "https://bahi-happa.web.app"');
        expect(files['www/download.html']).toContain('>bahi-happa.web.app/download<');
        for (const [file, text] of Object.entries(files)) {
            expect({ file, old: /happa-bfc07|516108799937|myhappa|happaapp/.test(text) }).toEqual({ file, old: false });
        }
    });

    test('a target may only swap the Firebase blocks, or give the app a whole side-by-side identity', () => {
        const dir = fs.mkdtempSync(path.join(ROOT, '.happa-test-'));
        try {
            fs.mkdirSync(path.join(dir, 'config', 'targets'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'config', 'targets', 'x.json'), JSON.stringify({ firebase: { projectId: 'happa-x' }, ownerConfirmed: true }));
            expect(() => loadTarget('x', dir)).toThrow(/ownerConfirmed/);
            expect(() => loadTarget('../x', dir)).toThrow(/Bad target name/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        const base = loadConfig(ROOT);
        const own = { firebase: { projectId: 'happa-x' }, appName: 'X', appNameHi: 'X', androidPackage: 'com.happa.x', apkName: 'x' };
        expect(() => withTarget(base, own)).not.toThrow();
        const { apkName: _drop, ...partial } = own;
        expect(() => withTarget(base, partial)).toThrow(/apkName/);
        expect(() => withTarget(base, { ...own, androidPackage: 'com.other' })).toThrow(/androidPackage/);
        expect(() => withTarget(base, { ...own, androidPackage: 'com.happa' })).toThrow(/androidPackage/);
        expect(() => withTarget(base, { ...own, apkName: base.apkName })).toThrow(/apkName/);
    });

    test('bahi-happa-dev is the side-by-side "Bahi Dev" app; the shop APK keeps com.happa', () => {
        const dev = withTarget(loadConfig(ROOT), loadTarget('bahi-happa-dev', ROOT));
        expect(configProblems(dev)).toEqual([]);
        expect(derive(dev)).toMatchObject({
            projectId: 'bahi-happa-dev', siteUrl: 'https://bahi-happa-dev.web.app', appName: 'Bahi Dev',
            androidPackage: 'com.happa.dev', androidNamespace: 'com.happa', apkFile: 'bahi-dev.apk',
            appCheckSiteKey: '6LdzmCEuAAAAAGQ_wwikq9EH6HaoI9pF62clXmXd',
            apkDownloadUrl: 'https://github.com/DDancingDeath/bahi/releases/download/dev-latest/bahi-dev.apk',
            latestReleaseApi: 'https://api.github.com/repos/DDancingDeath/bahi/releases/tags/dev-latest',
            downloadName: { en: 'Bahi Dev (test app)', hi: 'Bahi Dev (टेस्ट ऐप)' }
        });
        const files = Object.fromEntries(plan(ROOT, dev).map((p) => [p.file, p.wanted]));
        expect(files['www/download.html']).toContain('href="https://github.com/DDancingDeath/bahi/releases/download/dev-latest/bahi-dev.apk"');
        expect(files['www/download.html']).toContain('content="https://api.github.com/repos/DDancingDeath/bahi/releases/tags/dev-latest"');
        expect(files['www/download.html']).toContain('<span class="hi" data-happa="downloadNameHi">Bahi Dev (टेस्ट ऐप)</span>');
        expect(files['android/app/build.gradle']).toMatch(/^\s*applicationId "com\.happa\.dev"$/m);
        expect(files['android/app/build.gradle']).toMatch(/^\s*namespace "com\.happa"$/m);
        expect(files['android/app/src/main/res/values/strings.xml']).toContain('<string name="app_name">Bahi Dev</string>');
        expect(files['www/firebaseConfig.js']).toContain('"projectId": "bahi-happa-dev"');
        for (const [file, text] of Object.entries(files)) {
            expect({ file, other: /happa-bfc07|516108799937|myhappa|"bahi-happa"|6046579556/.test(text) }).toEqual({ file, other: false });
        }

        const prod = derive(bahi());
        expect(prod).toMatchObject({ projectId: 'bahi-happa', appName: 'Bahi', androidPackage: 'com.happa', androidNamespace: 'com.happa', apkFile: 'bahi.apk' });
        for (const d of [prod, derive(loadConfig(ROOT))]) {
            expect(d).toMatchObject({
                apkDownloadUrl: 'https://github.com/DDancingDeath/bahi/releases/latest/download/bahi.apk',
                latestReleaseApi: 'https://api.github.com/repos/DDancingDeath/bahi/releases/latest',
                downloadName: { en: 'Bahi', hi: 'Bahi' }
            });
        }
        const bad = (download) => configProblems({ ...loadConfig(ROOT), download }).filter((e) => e.startsWith('download'));
        expect(bad({ apkDownloadUrl: 'https://example.com/releases/download/dev-latest/bahi.apk' })).toHaveLength(1);
        expect(bad({ apkDownloadUrl: 'https://github.com/DDancingDeath/bahi/releases/download/dev-latest/other.apk' })).toHaveLength(1);
        expect(bad({ latestReleaseApi: 'https://api.github.com/repos/someone/else/releases/latest' })).toHaveLength(1);
        expect(bad({ name: { en: '<b>x</b>' } })).toHaveLength(1);
        expect(plan(ROOT, bahi()).find((p) => p.file === 'android/app/build.gradle').wanted)
            .toBe(fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8').replace(/\r\n/g, '\n'));
    });

    test('the dev APK is a pre-release, never latest, with its own google-services.json', () => {
        const android = workflow('android-release.yml');
        expect(android).toContain('--prerelease --latest=false');
        expect(android).toContain('gh release create dev-latest');
        expect(android).toContain('GOOGLE_SERVICES_JSON="$GOOGLE_SERVICES_JSON_DEV"');
        expect(android).toContain('--verify-tag --title "$title" --notes-file dist/release-notes.md --latest="$make_latest"');
    });
});
