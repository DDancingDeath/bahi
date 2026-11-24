/**
 * @fileoverview Printer context in reports: Crashlytics keys, logs and non-fatal reports only
 * while crash reports are on; an app that closed during a printer call is reported on the next start.
 */
import { PrinterTelemetry, PRINTER_STEP_KEY } from '../services/printer-telemetry.js';
import { CrashReports } from '../services/crash-reports.js';
import { TelemetryService } from '../services/telemetry.js';

const plugin = () => ({
    setCustomKey: jest.fn(() => Promise.resolve()),
    log: jest.fn(() => Promise.resolve()),
    recordException: jest.fn(() => Promise.resolve())
});

function crashReports(on, p) {
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'FirebaseCrashlytics', Plugins: { FirebaseCrashlytics: p } };
    CrashReports.state = 'on';
    localStorage.setItem('aadhat.crashReports', on ? '1' : '0');
}

beforeEach(() => {
    localStorage.clear();
    jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; SM-A145F) wv');
});
afterEach(() => {
    delete window.Capacitor;
    jest.restoreAllMocks();
});

test('crash reports on: printer keys, a log line and a non-fatal report with the step, never the MAC', async () => {
    const p = plugin();
    crashReports(true, p);
    await PrinterTelemetry.around('connect', { name: 'MPT-II' }, () => Promise.resolve());
    PrinterTelemetry.error('connect', Object.assign(new Error('Unable to connect to device'), { kind: 'connect' }));

    expect(p.setCustomKey).toHaveBeenCalledWith({ key: 'printer_name', value: 'MPT-II', type: 'string' });
    expect(p.setCustomKey).toHaveBeenCalledWith({ key: 'printer_step', value: 'connect', type: 'string' });
    expect(p.log).toHaveBeenCalledWith({ message: 'printer connect (MPT-II)' });
    const report = p.recordException.mock.calls[0][0];
    expect(report.message).toBe('Printer connect failed (connect): Unable to connect to device');
    expect(report.keysAndValues).toEqual(expect.arrayContaining([
        { key: 'printer_android', value: '14', type: 'string' },
        { key: 'printer_step', value: 'connect', type: 'string' }
    ]));
    expect(JSON.stringify(p.setCustomKey.mock.calls)).not.toMatch(/[0-9A-F]{2}:[0-9A-F]{2}:/);
});

test('crash reports off: nothing goes to Crashlytics', async () => {
    const p = plugin();
    crashReports(false, p);
    await PrinterTelemetry.around('connect', { name: 'MPT-II' }, () => Promise.resolve());
    PrinterTelemetry.error('connect', new Error('x'));
    expect(p.setCustomKey).not.toHaveBeenCalled();
    expect(p.recordException).not.toHaveBeenCalled();
});

test('the app closed during connect: the next start sends one warning with the step and printer name', async () => {
    const warn = jest.spyOn(TelemetryService, 'logWarning').mockImplementation(() => {});
    let markDuringCall;
    await PrinterTelemetry.around('connect', { name: 'MPT-II' }, () => {
        markDuringCall = JSON.parse(localStorage.getItem(PRINTER_STEP_KEY));
        return Promise.resolve();
    });
    expect(markDuringCall).toMatchObject({ step: 'connect', name: 'MPT-II', android: 14 });
    expect(localStorage.getItem(PRINTER_STEP_KEY)).toBeNull();
    expect(await PrinterTelemetry.reportUnfinished()).toBeNull();

    localStorage.setItem(PRINTER_STEP_KEY, JSON.stringify(markDuringCall));
    expect(await PrinterTelemetry.reportUnfinished(markDuringCall.at + 1000)).toMatchObject({ step: 'connect' });
    expect(warn).toHaveBeenCalledWith('App closed during printer connect', expect.objectContaining({ name: 'MPT-II', step: 'connect' }));
    expect(localStorage.getItem(PRINTER_STEP_KEY)).toBeNull();

    localStorage.setItem(PRINTER_STEP_KEY, JSON.stringify(markDuringCall));
    await PrinterTelemetry.reportUnfinished(markDuringCall.at + 2 * 24 * 60 * 60 * 1000);
    expect(warn).toHaveBeenCalledTimes(1);
});
