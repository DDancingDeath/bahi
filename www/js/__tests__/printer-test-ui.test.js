/**
 * @fileoverview Settings › Printing › Check the printer (ui/printer-test.js): the connection check
 * rows, and the test page sent in chunks through the printer link; a failure is a message and a
 * printer telemetry report with its step, never a crash.
 */
import fs from 'fs';
import path from 'path';
import { PrinterService } from '../services/printer.js';
import { PrinterTelemetry } from '../services/printer-telemetry.js';
import { PrinterTest } from '../ui/printer-test.js';
import { UIManager } from '../ui/ui-manager.js';
import { AppState } from '../utils/state.js';
import { CHUNK_BYTES, JOB_END, JOB_START } from '../utils/escpos-image.js';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'settings.html'), 'utf8');
const rows = () => Array.from(document.querySelectorAll('#printerCheckList li')).map(li => li.textContent.trim());

function mockPlugin({ writeOk = true } = {}) {
    window.bluetoothSerial = {
        connect: jest.fn((id, ok) => ok()),
        disconnect: jest.fn((ok) => ok()),
        isConnected: jest.fn((ok) => ok()),
        isEnabled: jest.fn((ok) => ok()),
        list: jest.fn((ok) => ok([])),
        write: jest.fn((bytes, ok, fail) => (writeOk ? ok() : fail('Broken pipe')))
    };
}

let toast;
let report;

beforeEach(() => {
    document.body.innerHTML = TEMPLATE;
    delete window.bluetoothSerial;
    localStorage.clear();
    Object.assign(PrinterService.manager.link, { deviceId: null, deviceName: null, stopped: false, lastDevice: null, sleep: () => Promise.resolve() });
    PrinterService.manager.link.status = { checkedAt: null, lastError: null, lastJob: null, bluetoothOff: false };
    AppState.printerSettings = { enabled: true, deviceId: 'AA:BB', deviceName: 'Shop printer' };
    toast = jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
    jest.spyOn(UIManager, 'showLoading').mockImplementation(() => {});
    jest.spyOn(UIManager, 'hideLoading').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    report = jest.spyOn(PrinterTelemetry, 'error');
    const ctx = {
        fillRect() {}, fillText() {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) })
    };
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
});

afterEach(() => {
    jest.restoreAllMocks();
    delete window.bluetoothSerial;
});

test('on the web the check says printing works in the Android app', async () => {
    await PrinterTest.check();
    expect(rows()).toEqual([expect.stringContaining('Printing works in the Android app')]);
});

test('in the app the check lists printer, Bluetooth, permission, connection and the last print', async () => {
    mockPlugin();
    await PrinterTest.check();
    expect(rows()).toEqual([
        expect.stringContaining('Printer: Shop printer, 58 mm'),
        expect.stringContaining('Bluetooth: on'),
        expect.stringContaining('not needed on this phone'),
        expect.stringContaining('not connected now'),
        expect.stringContaining('none yet on this phone')
    ]);
});

test('the test page goes in chunks: start with a printer-font line, bands of at most 1 KB, then the end', async () => {
    mockPlugin();
    expect(await PrinterTest.page()).toBe(true);
    const sent = window.bluetoothSerial.write.mock.calls.map(c => Array.from(new Uint8Array(c[0].buffer)));
    expect(sent.length).toBeGreaterThan(3);
    expect(sent[0].slice(0, JOB_START.length)).toEqual([...JOB_START]);
    expect(String.fromCharCode(...sent[0].slice(JOB_START.length))).toContain('Printer font: OK');
    expect(sent[1].slice(0, 6)).toEqual([0x1D, 0x76, 0x30, 0x00, 48, 0]);
    expect(Math.max(...sent.map(s => s.length))).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(sent[sent.length - 1]).toEqual([...JOB_END]);
    expect(toast).toHaveBeenCalledWith('Test page sent to the printer. Check the paper.');
    expect(rows()[4]).toMatch(/Last print: \d\d:\d\d, printed/);
});

test('a write that fails shows the reason, reports the step and records the result', async () => {
    mockPlugin({ writeOk: false });
    expect(await PrinterTest.page()).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Printer test failed'), 'error', 6000);
    expect(report).toHaveBeenCalledWith('test_page', expect.objectContaining({ outcome: 'uncertain' }));
    await PrinterTest.check({ ask: false });
    expect(rows()[4]).toMatch(/may have printed/);
});

test('no printer chosen: a clear message and a report, nothing sent', async () => {
    mockPlugin();
    AppState.printerSettings = { enabled: true, deviceId: null, deviceName: null };
    expect(await PrinterTest.page()).toBe(false);
    expect(window.bluetoothSerial.write).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('test_page', expect.objectContaining({ kind: 'no_printer' }));
    expect(rows()[0]).toContain('none chosen');
});
