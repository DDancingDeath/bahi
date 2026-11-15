import { shellMethod, parseRgb, toHex, isLight } from '../utils/native-shell.js';

describe('native shell helpers (Android app)', () => {
    test('shellMethod is null on the web and on an APK without the method', () => {
        expect(shellMethod('setSystemBars', {})).toBeNull();
        const old = { Capacitor: { isNativePlatform: () => true, Plugins: {} } };
        expect(shellMethod('setSystemBars', old)).toBeNull();
        const set = jest.fn();
        const win = { Capacitor: { isNativePlatform: () => true, Plugins: { AppShell: { setSystemBars: set } } } };
        shellMethod('setSystemBars', win)({ top: 'x' });
        expect(set).toHaveBeenCalledWith({ top: 'x' });
    });

    test('bar colours: a translucent tab bar is blended over the page, icons follow the lightness', () => {
        expect(parseRgb('rgba(255, 255, 255, 0.5)')).toEqual([255, 255, 255, 0.5]);
        expect(parseRgb('rgb(13 13 16 / 50%)')).toEqual([13, 13, 16, 0.5]);
        expect(parseRgb('nonsense')).toBeNull();
        expect(toHex([255, 255, 255, 0.5], [0, 0, 0, 1])).toBe('#808080');
        expect(toHex([247, 247, 249, 1], [0, 0, 0, 1])).toBe('#f7f7f9');
        expect(isLight('#f7f7f9')).toBe(true);
        expect(isLight('#0d0d10')).toBe(false);
    });
});
