/**
 * @fileoverview The start-up screen script (U-25): in the Android app it tells the system splash
 * to go once the screen is drawn, so there is no blank frame between them.
 */
import fs from 'fs';
import path from 'path';

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'boot', 'boot-splash.js'), 'utf8');

describe('boot splash hand-off (U-25)', () => {
    afterEach(() => {
        delete window.Capacitor;
        jest.restoreAllMocks();
    });

    const run = () => {
        document.body.innerHTML = '<div id="bootSplash"><p data-boot-text></p><p data-boot-slow hidden></p><button data-boot-retry hidden></button></div>';
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
        window.eval(SCRIPT);
    };

    test('the Android app hears when the start-up screen is drawn', async () => {
        const splashDone = jest.fn().mockResolvedValue(undefined);
        window.Capacitor = { Plugins: { AppShell: { splashDone } } };
        run();
        await Promise.resolve();
        expect(splashDone).toHaveBeenCalledTimes(1);
    });

    test('an older APK without the method, or the web, is left alone', () => {
        window.Capacitor = { Plugins: { AppShell: {} } };
        expect(run).not.toThrow();
        delete window.Capacitor;
        expect(run).not.toThrow();
    });
});
