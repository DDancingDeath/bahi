/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const WWW = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(WWW, 'download.html'), 'utf8');
const script = fs.readFileSync(path.join(WWW, 'js', 'boot', 'download-page.js'), 'utf8');

const CHANGELOG = { releases: [{ version: '1.0.0', date: '2026-11-01', notes: { en: ['Shop release note'] } }] };

async function render(api, release) {
    document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
    document.documentElement.lang = 'en';
    document.querySelector('meta[name="happa-release-api"]').content = api;
    const calls = [];
    global.fetch = jest.fn((url) => {
        calls.push(url);
        const body = url === '/changelog.json' ? CHANGELOG : release;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });
    window.eval(script);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    return {
        calls,
        version: document.getElementById('latestVersion').textContent,
        notes: [...document.querySelectorAll('#notesList li')].map((li) => li.textContent)
    };
}

describe('/download release info', () => {
    afterEach(() => { delete global.fetch; });

    test('the shop page shows the latest release tag and the changelog notes', async () => {
        const api = 'https://api.github.com/repos/DDancingDeath/bahi/releases/latest';
        const r = await render(api, { tag_name: 'v1.0.0-rc14', prerelease: false, name: 'happa v1.0.0-rc14', body: 'x', published_at: '2026-11-15T12:00:00Z' });
        expect(r.calls).toContain(api);
        expect(r.version).toBe('v1.0.0-rc14');
        expect(r.notes).toEqual(['Shop release note']);
    });

    test('a test app page shows its dev-latest version and notes, not the shop changelog', async () => {
        const api = 'https://api.github.com/repos/DDancingDeath/bahi/releases/tags/dev-latest';
        const r = await render(api, {
            tag_name: 'dev-latest', prerelease: true, name: 'bahi-dev 1.0.0-dev.20261115.2',
            body: 'Test app Bahi Dev (com.happa.dev), version 1.0.0-dev.20261115.2.\r\n\r\nIt installs next to the shop\'s Bahi app.',
            published_at: '2026-11-15T15:00:00Z'
        });
        expect(r.calls).toContain(api);
        expect(r.version).toBe('1.0.0-dev.20261115.2');
        expect(r.notes).toEqual(['Test app Bahi Dev (com.happa.dev), version 1.0.0-dev.20261115.2.', 'It installs next to the shop\'s Bahi app.']);
    });

    test('the release day reads "15 Nov 2026" (Hindi month names in Hindi), not ISO, and the language switch is a .seg', async () => {
        const api = 'https://api.github.com/repos/DDancingDeath/bahi/releases/latest';
        await render(api, { tag_name: 'v1.0.0-rc14', prerelease: false, name: 'happa v1.0.0-rc14', body: 'x', published_at: '2026-11-15T12:00:00Z' });
        expect(document.getElementById('latestDate').textContent).toBe('(15 Nov 2026)');
        const hi = document.querySelector('.seg [data-lang-option="hi"]');
        hi.click();
        expect(document.getElementById('latestDate').textContent).toBe('(15 नवंबर 2026)');
        expect(hi.getAttribute('aria-pressed')).toBe('true');
    });

    test('the page head is plain and the download button is the indigo primary', () => {
        const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
        expect(style).toMatch(/\.download-btn \{[^}]*background: var\(--accent-strong\); color: var\(--on-accent-strong\);/);
        expect(style).not.toMatch(/header \{[^}]*background/);
        expect(style).not.toMatch(/mode-sale/);
    });
});
