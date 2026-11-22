/**
 * @fileoverview Billing's printer button in the app bar, next to the bell: a dot shows the
 * Bluetooth printer's state, a tap opens a sheet with the Settings › Printing & receipts
 * printer panel (status, enable, saved printers, Scan, Test print, Disconnect) and a "Receipt options ›" row to the rest of
 * that Settings page (NEW-12). The panel is
 * moved into the sheet while it is open and put back on close, so there is one copy of it and
 * the bill being entered stays as it is. Shown only where Bluetooth printing works (the Android app).
 * @module ui/printer-shortcut
 */

import { PrinterService } from '../services/printer.js';
import { openSheet, closeSheet } from './ui-manager.js';
import { on, PRINTER_CHANGED } from '../utils/events.js';
import { t } from '../i18n/index.js';

/** Pages whose app bar has the printer button (Purchase / Retail sale, Wholesale). */
export const PRINTER_TABS = Object.freeze(['billing', 'wholesale-sales']);

const STATE_KEYS = {
    connected: 'ui.printer.state_connected',
    connecting: 'ui.printer.state_connecting',
    saved: 'ui.printer.state_not_connected',
    none: 'ui.printer.state_not_connected'
};

/**
 * @param {{available: boolean, connecting?: boolean, connected?: boolean, saved?: boolean}} s
 * @returns {'unavailable'|'connecting'|'connected'|'saved'|'none'}
 */
export function shortcutState({ available, connecting = false, connected = false, saved = false }) {
    if (!available) return 'unavailable';
    if (connecting) return 'connecting';
    if (connected) return 'connected';
    return saved ? 'saved' : 'none';
}

export const PrinterShortcut = {
    /** @type {?() => Promise<?HTMLElement>} set by init: the synced printer panel (Settings put in first) */
    loadPanel: null,
    /** @type {?() => *} set by init: opens Settings › Printing & receipts */
    openSettings: null,
    /** @type {?Comment} where the panel goes back to while it is in the sheet */
    home: null,
    opening: false,
    bound: false,

    /** @param {{loadPanel: () => Promise<?HTMLElement>, openSettings?: () => *}} deps */
    init({ loadPanel, openSettings = null }) {
        this.loadPanel = loadPanel;
        this.openSettings = openSettings;
        if (!this.bound && typeof window !== 'undefined') {
            this.bound = true;
            on(PRINTER_CHANGED, () => this.render());
            window.addEventListener('aadhat:tabshown', (e) => {
                if (!PRINTER_TABS.includes(e.detail?.tabId)) this.close();
                this.render();
            });
            window.addEventListener('aadhat:langchange', () => this.render());
            document.addEventListener('deviceready', () => PrinterService.updateStatus());
        }
        this.render();
    },

    state() {
        return shortcutState({
            available: PrinterService.isAvailable(),
            connecting: !!PrinterService.connecting,
            connected: PrinterService.isConnected(),
            saved: !!PrinterService.settings().deviceId
        });
    },

    render() {
        const btn = document.getElementById('printerShortcut');
        if (!btn) return;
        const state = this.state();
        const tab = document.querySelector('.tab.active')?.id;
        btn.hidden = state === 'unavailable' || !PRINTER_TABS.includes(tab);
        btn.dataset.state = state;
        const text = document.getElementById('printerShortcutState');
        if (text) text.textContent = STATE_KEYS[state] ? t(STATE_KEYS[state]) : '';
    },

    isOpen() {
        return !!this.home;
    },

    async open() {
        const sheet = document.getElementById('printerSheet');
        const body = document.getElementById('printerSheetBody');
        if (!sheet || !body || !this.loadPanel || this.opening || this.isOpen()) return false;
        this.opening = true;
        try {
            const panel = await this.loadPanel();
            if (!panel) return false;
            this.home = document.createComment('printer-panel');
            panel.before(this.home);
            body.appendChild(panel);
            openSheet(sheet);
            return true;
        } finally {
            this.opening = false;
        }
    },

    /**
     * "Receipt options ›": closes the sheet and opens Settings › Printing & receipts at the printed bill.
     */
    async receiptOptions() {
        this.close();
        await this.openSettings?.();
        document.getElementById('receiptSettingsCard')?.scrollIntoView?.({ block: 'start' });
    },

    close() {
        if (this.home) {
            const panel = document.getElementById('printerPanel');
            if (panel) this.home.replaceWith(panel);
            else this.home.remove();
            this.home = null;
        }
        const sheet = document.getElementById('printerSheet');
        if (sheet?.classList.contains('active')) closeSheet(sheet);
    }
};
