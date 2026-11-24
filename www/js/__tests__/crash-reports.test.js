/**
 * @fileoverview Crash reports for the Android app (#122): always on (owner decision), no switch.
 * Start-up enables collection, sets the Firebase uid and clears the old opt-out value.
 */
import { CrashReports, OLD_SWITCH_KEY } from '../services/crash-reports.js';

function nativeWith(plugin) {
    window.Capacitor = {
        isNativePlatform: () => true,
        isPluginAvailable: (name) => name === 'FirebaseCrashlytics' && !!plugin,
        Plugins: { FirebaseCrashlytics: plugin }
    };
}

const fakePlugin = () => ({
    setEnabled: jest.fn(async () => {}),
    setUserId: jest.fn(async () => {}),
    deleteUnsentReports: jest.fn(async () => {}),
    recordException: jest.fn(async () => {}),
    crash: jest.fn(async () => {})
});

beforeEach(() => {
    localStorage.clear();
    CrashReports.state = 'unavailable';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    delete window.Capacitor;
    jest.restoreAllMocks();
});

test('website: unavailable, nothing goes to Crashlytics', async () => {
    expect(await CrashReports.apply()).toBe('unavailable');
    expect(CrashReports.testReach()).toBe('web');
    expect(await CrashReports.sendTestException()).toBe(false);
    expect(await CrashReports.sendTestCrash()).toBe(false);
});

test('Android app: collection on even after an old opt-out, with the Firebase uid; nothing deleted', async () => {
    const plugin = fakePlugin();
    nativeWith(plugin);
    localStorage.setItem(OLD_SWITCH_KEY, '0');
    expect(await CrashReports.apply({ uid: 'u1' })).toBe('on');
    expect(plugin.setEnabled).toHaveBeenCalledWith({ enabled: true });
    expect(plugin.setUserId).toHaveBeenCalledWith({ userId: 'u1' });
    expect(plugin.deleteUnsentReports).not.toHaveBeenCalled();
    expect(localStorage.getItem(OLD_SWITCH_KEY)).toBeNull();
    expect(CrashReports.testReach()).toBe('on');
});

test('no Firebase config in the APK: "not set up", and crash() is never called (it would close the app)', async () => {
    const plugin = fakePlugin();
    plugin.setEnabled.mockRejectedValue(new Error('Default FirebaseApp is not initialized'));
    nativeWith(plugin);
    expect(await CrashReports.apply({ uid: 'u1' })).toBe('not-set-up');
    expect(CrashReports.testReach()).toBe('not-set-up');
    expect(await CrashReports.sendTestException()).toBe(false);
    expect(await CrashReports.sendTestCrash()).toBe(false);
    expect(plugin.setUserId).not.toHaveBeenCalled();
    expect(plugin.crash).not.toHaveBeenCalled();
});

test('before start-up has enabled it, the test crash is not offered', async () => {
    const plugin = fakePlugin();
    nativeWith(plugin);
    expect(CrashReports.testReach()).toBe('not-set-up');
    expect(await CrashReports.sendTestCrash()).toBe(false);
});

test('owner test: a non-fatal report, and a test crash only when asked; a failing report never throws', async () => {
    const plugin = fakePlugin();
    nativeWith(plugin);
    await CrashReports.apply();
    expect(await CrashReports.sendTestException()).toBe(true);
    expect(plugin.recordException).toHaveBeenCalledWith({ message: expect.stringMatching(/^Test error .*not a real error$/) });
    expect(plugin.crash).not.toHaveBeenCalled();
    expect(await CrashReports.sendTestCrash()).toBe(true);
    expect(plugin.crash).toHaveBeenCalledWith({ message: expect.stringMatching(/^Test crash/) });
    plugin.recordException.mockRejectedValue(new Error('boom'));
    expect(await CrashReports.sendTestException()).toBe(false);
});