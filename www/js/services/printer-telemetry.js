/**
 * @fileoverview Printer context for error and crash reports: the step (scan, connect, print),
 * the printer's Bluetooth name, Android's major version and the Nearby devices permissions go to
 * Crashlytics (custom keys, logs, non-fatal reports) (always on in the Android app).
 * A native call that may close the app is marked on the phone; if the app starts again with the
 * mark still there, the next start sends one warning to the `telemetry` collection, so an app that
 * closed while connecting is also in Diagnostics › Errors. No MAC address, no shop data.
 * @module services/printer-telemetry
 */

import { crashPlugin, CrashReports } from './crash-reports.js';
import { safeSetItem } from '../utils/storage-full.js';
import { getAndroidMajorVersion } from '../utils/helpers.js';

export const PRINTER_STEP_KEY = 'printerStep';
const STEP_TTL_MS = 24 * 60 * 60 * 1000;

const context = {};

const crashlytics = () => (CrashReports.testReach() === 'on' ? crashPlugin() : null);
const quiet = (call) => {
    try { Promise.resolve(call()).catch(() => {}); } catch { /* never into the caller */ }
};
const clean = (value) => String(value ?? '').slice(0, 60);

export const PrinterTelemetry = {
    /** Context kept for the next reports, e.g. {name: 'MPT-II', connect: 'granted'}. */
    note(fields = {}) {
        Object.entries(fields).forEach(([key, value]) => {
            if (value === undefined) return;
            context[key] = clean(value);
            const c = crashlytics();
            if (c) quiet(() => c.setCustomKey({ key: `printer_${key}`, value: context[key], type: 'string' }));
        });
    },

    context() {
        return { ...context, android: getAndroidMajorVersion() || 'none' };
    },

    step(step, fields = {}) {
        this.note({ ...fields, step });
        const c = crashlytics();
        if (c) quiet(() => c.log({ message: `printer ${step}${context.name ? ` (${context.name})` : ''}` }));
    },

    /** Runs a native printer call with the "in progress" mark around it. */
    async around(step, fields, run) {
        this.step(step, fields);
        safeSetItem(PRINTER_STEP_KEY, JSON.stringify({ ...this.context(), step, at: Date.now() }));
        try {
            return await run();
        } finally {
            try { localStorage.removeItem(PRINTER_STEP_KEY); } catch { /* ignore */ }
        }
    },

    /** A caught printer failure: a non-fatal Crashlytics report (when on). */
    error(step, error) {
        const c = crashlytics();
        if (!c) return;
        const kind = error?.kind || 'error';
        const keysAndValues = Object.entries({ ...this.context(), step, kind })
            .map(([key, value]) => ({ key: `printer_${key}`, value: clean(value), type: 'string' }));
        quiet(() => c.recordException({
            message: `Printer ${step} failed (${kind}): ${clean(error?.message || error)}`,
            keysAndValues
        }));
    },

    /**
     * At start-up: the mark of a printer call that never finished (the app closed during it).
     * Sends one warning and clears the mark. Never throws.
     * @returns {Promise<Object|null>} what was reported
     */
    async reportUnfinished(now = Date.now()) {
        let mark = null;
        try {
            mark = JSON.parse(localStorage.getItem(PRINTER_STEP_KEY) || 'null');
            localStorage.removeItem(PRINTER_STEP_KEY);
        } catch {
            return null;
        }
        if (!mark?.step || !(now - Number(mark.at) < STEP_TTL_MS)) return null;
        try {
            const { TelemetryService } = await import('./telemetry.js');
            TelemetryService.logWarning(`App closed during printer ${mark.step}`, mark);
        } catch (e) {
            console.warn('[PRINTER] report not sent:', e?.message || e);
        }
        return mark;
    }
};
