/**
 * @fileoverview Log out with changes not sent yet (U-03): the person is told, Wait and sync is
 * the main choice, and Log out anyway needs a second confirm and leaves an audit entry.
 */
import { AuthManager } from '../auth/authentication.js';
import { UIManager } from '../ui/ui-manager.js';
import { SyncStatus } from '../ui/sync-status.js';
import { AuditService } from '../services/audit.js';

let custom;
let modal;
let audit;

beforeEach(() => {
    custom = jest.spyOn(UIManager, 'showCustomModal');
    modal = jest.spyOn(UIManager, 'showModal');
    jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
    jest.spyOn(UIManager, 'showLoading').mockImplementation(() => {});
    jest.spyOn(UIManager, 'hideLoading').mockImplementation(() => {});
    audit = jest.spyOn(AuditService, 'log').mockResolvedValue();
    jest.spyOn(SyncStatus, 'isOnline').mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());

test('nothing waiting: the plain confirm', async () => {
    jest.spyOn(SyncStatus, 'unsentCount').mockResolvedValue(0);
    modal.mockResolvedValue(true);
    await expect(AuthManager.confirmLogoutWithUnsent()).resolves.toBe(true);
    expect(custom).not.toHaveBeenCalled();
});

test('Wait and sync is the primary choice and signs out once everything is sent', async () => {
    jest.spyOn(SyncStatus, 'unsentCount').mockResolvedValue(3);
    const wait = jest.spyOn(SyncStatus, 'waitUntilSent').mockResolvedValue(true);
    custom.mockResolvedValue('wait');
    await expect(AuthManager.confirmLogoutWithUnsent()).resolves.toBe(true);
    const [html, buttons] = custom.mock.calls[0];
    expect(html).toMatch('3 changes not sent yet');
    expect(buttons.find(b => b.value === 'wait').class).toMatch('btn-primary');
    expect(buttons.find(b => b.value === 'force').class).toMatch('btn-danger-outline');
    expect(wait).toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
});

test('Log out anyway asks again and is written to the audit log; Cancel keeps the person signed in', async () => {
    jest.spyOn(SyncStatus, 'unsentCount').mockResolvedValue(1);
    custom.mockResolvedValueOnce('force').mockResolvedValueOnce(null);
    modal.mockResolvedValueOnce(false);
    await expect(AuthManager.confirmLogoutWithUnsent()).resolves.toBe(false);
    expect(audit).not.toHaveBeenCalled();

    custom.mockResolvedValueOnce('force');
    modal.mockResolvedValueOnce(true);
    await expect(AuthManager.confirmLogoutWithUnsent()).resolves.toBe(true);
    expect(modal.mock.calls.at(-1)[3]).toMatchObject({ danger: true });
    expect(audit).toHaveBeenCalledWith(AuditService.ACTIONS.LOGOUT_WITH_UNSENT, expect.objectContaining({ unsent: 1 }));
});
