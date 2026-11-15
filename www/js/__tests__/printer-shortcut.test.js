/**
 * @fileoverview Billing's app-bar printer button, next to the bell: shown only in the Android app on
 * Billing / Wholesale, its dot follows the printer, and a tap opens the Settings printer panel in a
 * sheet without touching the bill being entered.
 */
import fs from 'fs';
import path from 'path';
import { PrinterShortcut, shortcutState } from '../ui/printer-shortcut.js';
import { PrinterService } from '../services/printer.js';
import { SettingsManager } from '../modules/settings.js';
import { UIManager } from '../ui/ui-manager.js';
import { AppState } from '../utils/state.js';

const read = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'templates', name), 'utf8');
const NAV = read('navigation.html');
const SETTINGS = read('settings.html');

const btn = () => document.getElementById('printerShortcut');
const sheet = () => document.getElementById('printerSheet');
const panel = () => document.getElementById('printerPanel');

function mockPlugin({ connect = (id, ok) => ok() } = {}) {
    window.bluetoothSerial = {
        connect: jest.fn(connect),
        disconnect: jest.fn((ok) => ok()),
        isConnected: jest.fn((ok) => ok()),
        isEnabled: jest.fn((ok) => ok()),
        list: jest.fn((ok) => ok([])),
        write: jest.fn((bytes, ok) => ok())
    };
}

function showTab(id) {
    document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === id));
    window.dispatchEvent(new CustomEvent('aadhat:tabshown', { detail: { tabId: id } }));
}

const loadPanel = jest.fn(async () => {
    SettingsManager.syncPrinterPanel();
    await SettingsManager.updatePrinterStatus();
    return panel();
});

beforeEach(() => {
    document.body.innerHTML = `${NAV}
        <div class="tab active" id="billing"><input id="billItemName" value="Wheat"><input id="billWeight" value="52.5"></div>
        <div class="tab" id="wholesale-sales"></div>
        <div class="tab" id="day"></div>
        <div class="tab" id="settings">${SETTINGS}</div>`;
    delete window.bluetoothSerial;
    localStorage.clear();
    PrinterShortcut.home = null;
    PrinterService.connecting = false;
    PrinterService.manager.device = null;
    PrinterService.manager.printerName = null;
    PrinterService.manager.link.stopped = false;
    PrinterService.manager.link.lastDevice = null;
    PrinterService.manager.link.sleep = () => Promise.resolve();
    AppState.printerSettings = { enabled: true, deviceId: null, deviceName: null };
    jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
    jest.spyOn(UIManager, 'showLoading').mockImplementation(() => {});
    jest.spyOn(UIManager, 'hideLoading').mockImplementation(() => {});
    jest.spyOn(UIManager, 'hapticFeedback').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    PrinterShortcut.init({ loadPanel });
});

afterEach(() => {
    PrinterShortcut.close();
    delete window.bluetoothSerial;
    jest.restoreAllMocks();
});

test('the button sits right before the bell, as an app-bar action named in the app language', () => {
    expect(btn().nextElementSibling.id).toBe('notifBell');
    expect(btn().getAttribute('data-i18n-aria-label')).toBe('ui.printer.shortcut');
    expect(btn().getAttribute('data-i18n-title')).toBe('ui.printer.shortcut');
    expect(btn().classList.contains('app-bar-action')).toBe(true);
});

test('state: unavailable without the plugin; connecting, connected, saved, none', () => {
    expect(shortcutState({ available: false, connected: true })).toBe('unavailable');
    expect(shortcutState({ available: true, connecting: true, connected: true })).toBe('connecting');
    expect(shortcutState({ available: true, connected: true })).toBe('connected');
    expect(shortcutState({ available: true, saved: true })).toBe('saved');
    expect(shortcutState({ available: true })).toBe('none');
});

test('on the web (no Bluetooth plugin) the button stays hidden, as Settings says printing needs the Android app', () => {
    PrinterShortcut.render();
    expect(btn().hidden).toBe(true);
});

test('in the Android app it shows on Billing and Wholesale only', () => {
    mockPlugin();
    PrinterShortcut.render();
    expect(btn().hidden).toBe(false);
    showTab('wholesale-sales');
    expect(btn().hidden).toBe(false);
    showTab('day');
    expect(btn().hidden).toBe(true);
    showTab('billing');
    expect(btn().hidden).toBe(false);
});

test('the dot follows the printer: none, saved, connecting (amber), connected (green), then disconnected', async () => {
    let finish;
    mockPlugin({ connect: (id, ok) => { finish = ok; } });
    PrinterShortcut.render();
    expect(btn().dataset.state).toBe('none');

    AppState.printerSettings = { enabled: true, deviceId: 'AA', deviceName: 'Counter' };
    PrinterService.updateStatus();
    expect(btn().dataset.state).toBe('saved');
    expect(document.getElementById('printerShortcutState').textContent).toBe('Not connected');

    const connecting = PrinterService.connect('AA', 'Counter');
    expect(btn().dataset.state).toBe('connecting');
    while (!finish) await new Promise(r => setTimeout(r, 0));
    finish();
    await connecting;
    expect(btn().dataset.state).toBe('connected');
    expect(document.getElementById('printerShortcutState').textContent).toBe('Connected');

    await PrinterService.disconnect();
    expect(btn().dataset.state).toBe('saved');
});

describe('the sheet', () => {
    test('a tap opens the Settings printer panel in the sheet; closing puts it back and keeps the bill', async () => {
        mockPlugin();
        PrinterShortcut.render();
        expect(await PrinterShortcut.open()).toBe(true);
        expect(sheet().classList.contains('active')).toBe(true);
        expect(document.getElementById('printerSheetBody').contains(panel())).toBe(true);
        expect(document.getElementById('scanPrintersBtn').hidden).toBe(false);

        PrinterShortcut.close();
        expect(sheet().classList.contains('active')).toBe(false);
        expect(document.querySelectorAll('#printerPanel')).toHaveLength(1);
        expect(document.getElementById('settingsPrinting').contains(panel())).toBe(true);
        expect(document.getElementById('billItemName').value).toBe('Wheat');
        expect(document.getElementById('billWeight').value).toBe('52.5');
        expect(document.getElementById('billing').classList.contains('active')).toBe(true);
    });

    test('a saved printer that is not connected connects with one tap; then Test print and Disconnect show', async () => {
        mockPlugin();
        AppState.printerSettings = { enabled: true, deviceId: 'AA', deviceName: 'Counter', printers: [{ deviceId: 'AA', deviceName: 'Counter', widthMm: 58 }] };
        await PrinterShortcut.open();
        const use = panel().querySelector('.saved-printer .saved-printer-use');
        expect(use.textContent).toBe('Connect');
        use.click();
        await new Promise(r => setTimeout(r, 0));
        expect(window.bluetoothSerial.connect).toHaveBeenCalledWith('AA', expect.any(Function), expect.any(Function));
        expect(btn().dataset.state).toBe('connected');
        expect(panel().querySelector('.saved-printer .saved-printer-use')).toBeNull();
        expect(document.getElementById('testPrintBtn').hidden).toBe(false);
        expect(document.getElementById('disconnectBtn').hidden).toBe(false);
    });

    test('with printing off on this phone the sheet offers the enable switch', async () => {
        mockPlugin();
        AppState.printerSettings = { enabled: false, deviceId: null, deviceName: null };
        await PrinterShortcut.open();
        const toggle = document.getElementById('settingBluetoothEnabled');
        expect(document.getElementById('printerSheetBody').contains(toggle)).toBe(true);
        expect(toggle.checked).toBe(false);
        expect(document.getElementById('bluetoothPrinterSection').hidden).toBe(true);
        toggle.checked = true;
        SettingsManager.toggleBluetoothPrinter();
        expect(document.getElementById('bluetoothPrinterSection').hidden).toBe(false);
        expect(PrinterService.settings().enabled).toBe(true);
    });

    test('leaving Billing closes the sheet and returns the panel', async () => {
        mockPlugin();
        await PrinterShortcut.open();
        showTab('day');
        expect(sheet().classList.contains('active')).toBe(false);
        expect(document.getElementById('settingsPrinting').contains(panel())).toBe(true);
    });
});
