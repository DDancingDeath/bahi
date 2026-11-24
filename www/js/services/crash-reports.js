/**
 * @fileoverview Crash reports for the Android app (#122): Firebase Crashlytics through the
 * @capacitor-firebase/crashlytics plugin, always on (owner decision, no switch; the manifest
 * enables collection and start-up enables it again, so an old stored opt-out is ignored).
 * The user id is the Firebase uid; the only keys and logs are the printer's
 * (services/printer-telemetry.js), never phone numbers, MAC addresses or customer names.
 * A report holds the crash and its message, the phone model, Android and app version, device
 * state and an install id. docs/error-reporting.md.
 * @module services/crash-reports
 */

/** The old per-phone switch (removed): cleared at start-up, never read. */
export const OLD_SWITCH_KEY = 'aadhat.crashReports';
export const TEST_EXCEPTION_MESSAGE = 'Test error sent by the owner from Diagnostics, not a real error';
export const TEST_CRASH_MESSAGE = 'Test crash sent by the owner from Diagnostics';

/** The native plugin in the Android app, or null (website, older APK). */
export function crashPlugin(win = window) {
    const cap = win.Capacitor;
    if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.('FirebaseCrashlytics')) return null;
    return cap.Plugins?.FirebaseCrashlytics || null;
}

export const CrashReports = {
    /** Last result of apply(): 'on' | 'unavailable' | 'not-set-up'. */
    state: 'unavailable',

    /**
     * Turns collection on and sets the signed-in person's Firebase uid. Never throws.
     * @param {{uid?: string|null}} [opts]
     * @returns {Promise<string>} the state
     */
    async apply({ uid = null } = {}) {
        try { localStorage.removeItem(OLD_SWITCH_KEY); } catch { /* ignore */ }
        const plugin = crashPlugin();
        if (!plugin) {
            this.state = 'unavailable';
            return this.state;
        }
        try {
            await plugin.setEnabled({ enabled: true });
            this.state = 'on';
        } catch (e) {
            // No Firebase config in this APK (docs/error-reporting.md, set-up)
            console.warn('Crash reports not set up:', e?.message || e);
            this.state = 'not-set-up';
            return this.state;
        }
        if (uid && typeof plugin.setUserId === 'function') {
            try { await plugin.setUserId({ userId: String(uid) }); } catch { /* ignore */ }
        }
        return this.state;
    },

    /**
     * Whether an owner's test can reach Crashlytics from here (#122):
     * 'web' (no plugin), 'not-set-up' (no Firebase config in this APK) or 'on'.
     * @returns {'web'|'not-set-up'|'on'}
     */
    testReach() {
        if (!crashPlugin()) return 'web';
        return this.state === 'on' ? 'on' : 'not-set-up';
    },

    /**
     * A non-fatal test report; sent by Crashlytics on the next app start. Never throws.
     * @param {string} [message]
     * @returns {Promise<boolean>} recorded
     */
    async sendTestException(message = TEST_EXCEPTION_MESSAGE) {
        if (this.testReach() !== 'on') return false;
        try {
            await crashPlugin().recordException({ message });
            return true;
        } catch (e) {
            console.warn('Test crash report not recorded:', e?.message || e);
            return false;
        }
    },

    /**
     * Closes the app with a test crash. The plugin's crash() throws even without a Firebase
     * config, so it is called only while reports are on (and therefore set up).
     * @param {string} [message]
     * @returns {Promise<boolean>} false when not called
     */
    async sendTestCrash(message = TEST_CRASH_MESSAGE) {
        if (this.testReach() !== 'on') return false;
        await crashPlugin().crash({ message });
        return true;
    }
};
