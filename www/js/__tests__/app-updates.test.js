import { AppUpdatesManager } from '../modules/app-updates.js';

describe('Android update card and version (UX U-44, U-81)', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = `
            <div id="day" class="tab"><div class="day-container"><div class="tabs day-tabs"></div></div></div>
            <span id="appVersionText"></span><p id="appUpdateOffer" hidden></p>`;
        window.Capacitor = { isNativePlatform: () => true, Plugins: { App: { getInfo: async () => ({ version: '1.0.0-rc14', build: '10000014' }) } } };
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ tag_name: 'v1.0.0-rc15' }) }));
    });

    afterEach(() => {
        delete window.Capacitor;
        delete global.fetch;
        AppUpdatesManager.offeredVersion = null;
    });

    test('the card sits at the top of Today in the page, never floating over Billing; Settings shows the offer', async () => {
        await AppUpdatesManager.checkForAndroidUpdate(Date.now());
        const card = document.getElementById('appUpdateBanner');
        expect(card.parentElement).toBe(document.querySelector('#day .day-container'));
        expect(card.parentElement.firstElementChild).toBe(card);
        expect(card.textContent).toContain('1.0.0-rc15');
        expect(document.getElementById('appUpdateOffer').hidden).toBe(false);
    });

    test('Later hides it for a day; × skips this version', async () => {
        await AppUpdatesManager.checkForAndroidUpdate(Date.now());
        const [, later] = document.querySelectorAll('#appUpdateBanner button');
        later.click();
        expect(document.getElementById('appUpdateBanner')).toBeNull();
        await AppUpdatesManager.checkForAndroidUpdate(Date.now() + 60 * 60 * 1000);
        expect(document.getElementById('appUpdateBanner')).toBeNull();
        await AppUpdatesManager.checkForAndroidUpdate(Date.now() + 25 * 60 * 60 * 1000);
        expect(document.getElementById('appUpdateBanner')).not.toBeNull();
        document.querySelectorAll('#appUpdateBanner button')[2].click();
        expect(close).toBeTruthy();
        await AppUpdatesManager.checkForAndroidUpdate(Date.now() + 26 * 60 * 60 * 1000);
        expect(document.getElementById('appUpdateBanner')).toBeNull();
        expect(document.getElementById('appUpdateOffer').hidden).toBe(true);
    });

    test('Settings › Help & about shows the installed APK version and build, not the bundled one', async () => {
        AppUpdatesManager.renderSettings();
        await new Promise(r => setTimeout(r, 0));
        expect(document.getElementById('appVersionText').textContent).toBe('1.0.0-rc14 (10000014)');
    });
});
