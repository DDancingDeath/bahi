/**
 * @fileoverview User-profile access for admin.js goes through
 * FirebaseService (#123): env prefix, client-side createdAt ordering, and the
 * exact fields the approve / role-change flows write.
 */
import fs from 'fs';
import path from 'path';
import { FirebaseService } from '../firebase/firestore-service.js';
import { AdminManager } from '../modules/admin.js';
import { AppState } from '../utils/state.js';
import { UIManager } from '../ui/ui-manager.js';
import { createFakeFirestore } from './__mocks__/fake-firestore.js';
import { notificationText } from '../utils/notification-format.js';

let fake;

beforeEach(() => {
    fake = createFakeFirestore();
    global.firebase = fake.firebase;
    window.COLLECTION_PREFIX = 'dev_';
    fake.seed('dev_users', [
        { id: 'old', name: 'Old', role: 'staff', status: 'active', createdAt: { toMillis: () => 1000 } },
        { id: 'legacy', name: 'Legacy', role: 'owner' },
        { id: 'new', name: 'New', status: 'pending', createdAt: { toMillis: () => 5000 } },
    ]);
    fake.seed('users', [{ id: 'prod', name: 'Prod user', role: 'owner' }]);
    AppState.currentUser = { uid: 'owner-1' };
    AppState.userRole = 'owner';
});

afterEach(() => {
    delete window.COLLECTION_PREFIX;
});

const userDoc = (id) => fake.raw('dev_users').get(id);

describe('FirebaseService user methods', () => {
    test('loadUsers reads the prefixed collection, newest first, legacy (no createdAt) last', async () => {
        const users = await FirebaseService.loadUsers();
        expect(users.map(u => u.id)).toEqual(['new', 'old', 'legacy']);
        expect(users[0]).toMatchObject({ id: 'new', name: 'New', status: 'pending' });
    });

    test('updateUser touches only the prefixed profile', async () => {
        await FirebaseService.updateUser('old', { role: 'manager' });
        expect(userDoc('old')).toMatchObject({ role: 'manager', status: 'active', name: 'Old' });
        expect(fake.raw('users').get('prod')).toBeDefined();
    });

    test('countDocuments uses the prefix', async () => {
        expect(await FirebaseService.countDocuments('users')).toBe(3);
        expect(await FirebaseService.countDocuments('empty')).toBe(0);
    });
});

describe('admin flows write the same fields as before', () => {
    test('AdminManager.approveUser sets status, chosen role, approvedAt, approvedBy', async () => {
        document.body.innerHTML = '<select id="role-new"><option value="manager" selected>m</option></select>';
        await AdminManager.approveUser('new');
        expect(userDoc('new')).toMatchObject({ status: 'active', role: 'manager', approvedBy: 'owner-1' });
        expect(typeof userDoc('new').approvedAt).toBe('number');
    });

    test('admin.js does not open Firestore directly', () => {
        for (const file of ['admin.js']) {
            const src = fs.readFileSync(path.join(__dirname, '..', 'modules', file), 'utf8');
            expect(src).not.toMatch(/firebase\.firestore\(\)|\.collection\(/);
        }
    });
});

describe('reset password and remove user (AadhatManagementApp#74)', () => {
    let auth;
    let modal;
    let toast;

    beforeEach(() => {
        auth = { sendPasswordResetEmail: jest.fn(async () => {}) };
        global.firebase = { ...fake.firebase, auth: () => auth };
        modal = jest.spyOn(UIManager, 'showModal').mockResolvedValue(true);
        toast = jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        jest.spyOn(UIManager, 'showLoading').mockImplementation(() => {});
        jest.spyOn(UIManager, 'hideLoading').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        document.body.innerHTML = '<div id="adminPendingUsers"></div><div id="adminActiveUsers"></div>';
    });

    test('reset sends the Firebase Auth reset email after confirmation', async () => {
        await expect(AdminManager.resetUserPassword('old', 'old@x.com')).resolves.toBe(true);
        expect(modal.mock.calls[0][0]).toContain('old@x.com');
        expect(auth.sendPasswordResetEmail).toHaveBeenCalledWith('old@x.com');
        expect(auth.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    test('reset does nothing when cancelled, without an email, or for a non-owner', async () => {
        modal.mockResolvedValueOnce(false);
        expect(await AdminManager.resetUserPassword('old', 'old@x.com')).toBe(false);
        expect(await AdminManager.resetUserPassword('old', '')).toBe(false);
        AppState.userRole = 'manager';
        expect(await AdminManager.resetUserPassword('old', 'old@x.com')).toBe(false);
        expect(auth.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    test('reset failure is shown in the app language, never as raw Firebase text (#105)', async () => {
        auth.sendPasswordResetEmail.mockRejectedValueOnce(Object.assign(new Error('Firebase: Error (auth/user-not-found).'), { code: 'auth/user-not-found' }));
        expect(await AdminManager.resetUserPassword('old', 'old@x.com')).toBe(false);
        expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('No account found with this email'), 'error');
        expect(toast.mock.calls.at(-1)[0]).not.toContain('Firebase:');
    });

    test('remove keeps a disabled profile without role, and hides it from both lists', async () => {
        fake.seed('dev_users', [{ id: 'old', name: 'Old', email: 'o@x', role: 'manager', rentRole: 'member', status: 'active', approvedBy: 'owner-1' }]);
        await expect(AdminManager.deleteUser('old', 'Old')).resolves.toBe(true);
        expect(modal.mock.calls[0][0]).toContain('Old');
        const doc = userDoc('old');
        expect(doc).toMatchObject({ status: 'disabled', disabledBy: 'owner-1', name: 'Old', email: 'o@x' });
        expect(doc).not.toHaveProperty('role');
        expect(doc).not.toHaveProperty('rentRole');
        expect(doc).not.toHaveProperty('approvedBy');
        expect(document.getElementById('adminActiveUsers').textContent).not.toContain('Old');
        expect(document.getElementById('adminPendingUsers').textContent).not.toContain('Old');
    });

    test('remove is refused when cancelled, for a non-owner, or for yourself', async () => {
        modal.mockResolvedValueOnce(false);
        expect(await AdminManager.deleteUser('old', 'Old')).toBe(false);
        expect(await AdminManager.deleteUser('owner-1', 'Me')).toBe(false);
        AppState.userRole = 'manager';
        expect(await AdminManager.deleteUser('old', 'Old')).toBe(false);
        expect(userDoc('old')).toMatchObject({ role: 'staff', status: 'active' });
    });

    test('reject keeps the profile as rejected (#84); it shows under Removed and rejected, not as pending', async () => {
        document.body.innerHTML += '<div id="adminRemovedCard" hidden><div id="adminRemovedUsers"></div></div>';
        await expect(AdminManager.rejectUser('new')).resolves.toBe(true);
        expect(userDoc('new')).toMatchObject({ status: 'rejected', rejectedBy: 'owner-1', name: 'New' });
        expect(document.getElementById('adminPendingUsers').textContent).not.toContain('New');
        expect(document.getElementById('adminRemovedCard').hidden).toBe(false);
        expect(document.getElementById('adminRemovedUsers').textContent).toContain('New');
    });

    test('restore puts a removed or rejected person back as a pending registration (#84)', async () => {
        fake.seed('dev_users', [
            { id: 'gone', name: 'Gone', status: 'disabled', disabledBy: 'owner-1', disabledAt: 1 },
            { id: 'no', name: 'No', role: 'staff', status: 'rejected', rejectedBy: 'owner-1', rejectedAt: 1 }
        ]);
        document.body.innerHTML += '<div id="adminRemovedCard"><div id="adminRemovedUsers"></div></div>';
        await expect(AdminManager.restoreUser('gone', 'Gone')).resolves.toBe(true);
        await expect(AdminManager.restoreUser('no', 'No')).resolves.toBe(true);
        for (const id of ['gone', 'no']) {
            const doc = userDoc(id);
            expect(doc).toMatchObject({ status: 'pending', role: 'staff' });
            ['disabledAt', 'disabledBy', 'rejectedAt', 'rejectedBy'].forEach(k => expect(doc).not.toHaveProperty(k));
        }
        expect(document.getElementById('adminPendingUsers').textContent).toContain('Gone');
        AppState.userRole = 'manager';
        expect(await AdminManager.restoreUser('old', 'Old')).toBe(false);
    });
});

describe('team directory settings/team (#87)', () => {
    beforeEach(() => {
        FirebaseService.forgetPeopleCaches();
        window.getCollection = (name) => `dev_${name}`;
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => { delete window.getCollection; });
    const team = () => fake.raw('dev_settings')?.get('team');
    const flush = () => new Promise(r => setTimeout(r, 0));

    test("the owner's profile read writes names and roles of approved people only, and only when they changed", async () => {
        await FirebaseService.loadUsers();
        await flush();
        expect(team().people).toEqual({ legacy: { name: 'Legacy', role: 'owner' }, old: { name: 'Old', role: 'staff' } });
        expect(JSON.stringify(team())).not.toContain('@');
        const before = team();
        await FirebaseService.loadUsers();
        await flush();
        expect(team()).toBe(before);
        await FirebaseService.updateUser('old', { role: 'manager' });
        await FirebaseService.loadUsers();
        await flush();
        expect(team().people.old).toEqual({ name: 'Old', role: 'manager' });
    });

    test('a manager reads the directory, never the profiles', async () => {
        fake.seed('dev_settings', [{ id: 'team', people: { old: { name: 'Old', role: 'staff' }, legacy: { name: 'Legacy', role: 'owner' } } }]);
        AppState.userRole = 'manager';
        const users = jest.spyOn(FirebaseService, 'loadUsers');
        const people = await FirebaseService.loadPeople();
        expect(people.map(p => p.id).sort()).toEqual(['legacy', 'old']);
        expect(people.find(p => p.id === 'old')).toEqual({ id: 'old', name: 'Old', role: 'staff' });
        expect(users).not.toHaveBeenCalled();
        fake.raw('dev_settings').delete('team');
        expect(await FirebaseService.loadPeople()).toEqual([]);
    });

    test("once a day the owner's phone rebuilds the directory when it is missing or differs; managers never do", async () => {
        localStorage.clear();
        AppState.userRole = 'manager';
        expect(await FirebaseService.ensureTeamDirectory()).toBe(false);
        expect(team()).toBeUndefined();
        AppState.userRole = 'owner';
        expect(await FirebaseService.ensureTeamDirectory()).toBe(true);
        expect(Object.keys(team().people).sort()).toEqual(['legacy', 'old']);
        // the same day: nothing read
        FirebaseService.forgetPeopleCaches();
        const users = jest.spyOn(FirebaseService, 'loadUsers');
        expect(await FirebaseService.ensureTeamDirectory()).toBe(false);
        expect(users).not.toHaveBeenCalled();
        users.mockRestore();
        // next day, an existing but stale directory (a name changed in Settings › account) is rebuilt
        localStorage.clear();
        FirebaseService.forgetPeopleCaches();
        fake.seed('dev_settings', [{ id: 'team', people: { old: { name: 'Old', role: 'staff' }, legacy: { name: 'Before', role: 'owner' } } }]);
        expect(await FirebaseService.ensureTeamDirectory()).toBe(true);
        expect(team().people.legacy).toEqual({ name: 'Legacy', role: 'owner' });
        // up to date: read, nothing written
        localStorage.clear();
        FirebaseService.forgetPeopleCaches();
        expect(await FirebaseService.ensureTeamDirectory()).toBe(false);
    });
});

describe('owners (multi-owner): the role choice, its confirmations and the owner list', () => {
    let modal;
    let toast;
    let picker;
    const team = () => fake.raw('dev_settings')?.get('team');
    const audit = () => [...(fake.raw('dev_auditLogs')?.values() || [])];

    beforeEach(async () => {
        FirebaseService.forgetPeopleCaches();
        window.getCollection = (name) => `dev_${name}`;
        fake.raw('dev_users').clear();
        fake.seed('dev_users', [
            { id: 'owner-1', name: 'Me', role: 'owner', status: 'active' },
            { id: 'mgr', name: 'Ramesh', role: 'manager', status: 'active' },
            { id: 'pend', name: 'Newbie', role: 'staff', status: 'pending' }
        ]);
        modal = jest.spyOn(UIManager, 'showModal').mockResolvedValue(true);
        toast = jest.spyOn(UIManager, 'showToast').mockImplementation(() => {});
        picker = jest.spyOn(UIManager, 'showCustomModal');
        jest.spyOn(UIManager, 'showLoading').mockImplementation(() => {});
        jest.spyOn(UIManager, 'hideLoading').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        document.body.innerHTML = '<div id="adminUserCounts"></div><div id="adminPendingUsers"></div><div id="adminActiveUsers"></div>';
        await AdminManager.loadUsers();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        delete window.getCollection;
    });

    const addOwner = async (id, name) => {
        fake.seed('dev_users', [{ id, name, role: 'owner', status: 'approved' }]);
        await AdminManager.loadUsers();
    };

    test('the owner picks Member / Manager / Owner; making someone owner asks first, then saves the role, the list and the audit entry', async () => {
        picker.mockResolvedValueOnce('owner');
        await expect(AdminManager.showChangeRole('mgr', 'Ramesh', 'manager')).resolves.toBe(true);
        expect(picker.mock.calls[0][1].map(b => b.text)).toEqual(['Member', 'Manager (now)', 'Owner', 'Cancel']);
        expect(picker.mock.calls[0][0]).toContain('Role for Ramesh');
        expect(modal.mock.calls[0][0]).toBe('Ramesh will get full control: money, settings, people, deleting bills. Make owner?');
        expect(modal.mock.calls[0][3]).toMatchObject({ confirmLabel: 'Make owner', danger: true });
        expect(userDoc('mgr').role).toBe('owner');
        expect(team().ownerUids).toEqual(['owner-1', 'mgr']);
        await new Promise(r => setTimeout(r, 0));
        expect(audit()).toEqual([expect.objectContaining({
            action: 'CHANGE_USER_ROLE', userId: 'owner-1',
            details: { targetUserId: 'mgr', targetName: 'Ramesh', from: 'manager', to: 'owner' }
        })]);
        expect(document.getElementById('adminActiveUsers').textContent).toContain('Owner');
    });

    test('Hindi has the same confirmation', async () => {
        const { default: hi } = await import('../i18n/hi.js');
        expect(hi['msg.owners.confirm_make_owner']).toBe('{userName} को पूरा नियंत्रण मिलेगा: पैसा, सेटिंग्स, लोग, बिल मिटाना। मालिक बनाएँ?');
    });

    test('cancel at the choice or the confirmation changes nothing', async () => {
        picker.mockResolvedValueOnce(null);
        expect(await AdminManager.showChangeRole('mgr', 'Ramesh', 'manager')).toBe(false);
        picker.mockResolvedValueOnce('owner');
        modal.mockResolvedValueOnce(false);
        expect(await AdminManager.showChangeRole('mgr', 'Ramesh', 'manager')).toBe(false);
        expect(userDoc('mgr').role).toBe('manager');
        expect(team().ownerUids).toEqual(['owner-1']);
    });

    test('a manager never gets the choice', async () => {
        AppState.userRole = 'manager';
        expect(await AdminManager.showChangeRole('mgr', 'Ramesh', 'manager')).toBe(false);
        expect(picker).not.toHaveBeenCalled();
        AppState.userRole = 'owner';
    });

    test('a pending person is approved first: no Owner in the approve list, and no owner role before approval', async () => {
        expect(document.getElementById('adminPendingUsers').innerHTML).not.toContain('value="owner"');
        picker.mockResolvedValueOnce('owner');
        expect(await AdminManager.showChangeRole('pend', 'Newbie', 'staff')).toBe(false);
        expect(toast).toHaveBeenLastCalledWith('Approve this person first, then change their role.', 'error');
        expect(modal).not.toHaveBeenCalled();
    });

    test('the only owner cannot step down; their row offers Edit role', async () => {
        expect(document.getElementById('adminActiveUsers').innerHTML).toContain("admin.showChangeRole('owner-1'");
        picker.mockResolvedValueOnce('manager');
        expect(await AdminManager.showChangeRole('owner-1', 'Me', 'owner')).toBe(false);
        expect(toast).toHaveBeenLastCalledWith('There must always be at least one owner. Make someone else owner first.', 'error');
        expect(userDoc('owner-1').role).toBe('owner');
    });

    test('with two owners one demotes the other after a strong confirmation; both are listed first', async () => {
        await addOwner('o2', 'Second');
        picker.mockResolvedValueOnce('manager');
        await expect(AdminManager.showChangeRole('o2', 'Second', 'owner')).resolves.toBe(true);
        expect(modal.mock.calls[0][0]).toContain('Second is an owner. They will lose full control');
        expect(modal.mock.calls[0][3]).toMatchObject({ danger: true, confirmLabel: 'Take away owner' });
        expect(userDoc('o2').role).toBe('manager');
        expect(team().ownerUids).toEqual(['owner-1']);
    });

    test('an owner steps down while another owner exists, and the app restarts', async () => {
        await addOwner('o2', 'Second');
        const restart = jest.spyOn(AdminManager, 'restartAfterStepDown').mockImplementation(() => {});
        picker.mockResolvedValueOnce('staff');
        await expect(AdminManager.showChangeRole('owner-1', 'Me', 'owner')).resolves.toBe(true);
        expect(modal.mock.calls[0][0]).toContain('You will stop being an owner and become Member');
        expect(modal.mock.calls[0][0]).toContain('You are the founder: once you step down');
        expect(userDoc('owner-1').role).toBe('staff');
        expect(team().ownerUids).toEqual(['o2']);
        expect(restart).toHaveBeenCalled();
    });

    test('removing another owner asks strongly and takes them off the list', async () => {
        await addOwner('o2', 'Second');
        await expect(AdminManager.deleteUser('o2', 'Second')).resolves.toBe(true);
        expect(modal.mock.calls[0][0]).toContain('"Second" is an owner.');
        expect(userDoc('o2')).toMatchObject({ status: 'disabled' });
        expect(userDoc('o2')).not.toHaveProperty('role');
        expect(team().ownerUids).toEqual(['owner-1']);
    });

    test('startup lists this owner once when the list is missing', async () => {
        fake.raw('dev_settings').delete('team');
        localStorage.clear();
        expect(await FirebaseService.ensureSelfListedOwner()).toBe(true);
        expect(team().ownerUids).toEqual(['owner-1']);
        expect(await FirebaseService.ensureSelfListedOwner()).toBe(false);
        localStorage.clear();
        expect(await FirebaseService.ensureSelfListedOwner()).toBe(false);
        AppState.userRole = 'manager';
        localStorage.clear();
        fake.raw('dev_settings').delete('team');
        expect(await FirebaseService.ensureSelfListedOwner()).toBe(false);
        expect(team()).toBeUndefined();
        AppState.userRole = 'owner';
    });
    test('the first owner is recorded once with the owner list: the earliest-created active owner, ties by uid', async () => {
        fake.raw('dev_settings').delete('team');
        fake.raw('dev_users').clear();
        FirebaseService.forgetPeopleCaches();
        fake.seed('dev_users', [
            { id: 'owner-1', name: 'Me', role: 'owner', status: 'active', createdAt: new Date('2026-03-01') },
            { id: 'b-old', name: 'Old', role: 'owner', status: 'approved', createdAt: new Date('2026-01-01') },
            { id: 'a-old', name: 'Tie', role: 'owner', status: 'approved', createdAt: new Date('2026-01-01') },
            { id: 'gone', name: 'Gone', role: 'owner', status: 'disabled', createdAt: new Date('2025-01-01') },
            { id: 'mgr', name: 'Ramesh', role: 'manager', status: 'active', createdAt: new Date('2024-01-01') }
        ]);
        await AdminManager.loadUsers();
        expect([...team().ownerUids].sort()).toEqual(['a-old', 'b-old', 'owner-1']);
        expect(team().firstOwnerUid).toBe('a-old');
        expect(document.getElementById('adminActiveUsers').textContent).toContain('Founder');
        fake.seed('dev_users', [{ id: 'aaa', name: 'No date', role: 'owner', status: 'active' }]);
        FirebaseService.forgetPeopleCaches();
        await AdminManager.loadUsers();
        expect(team().firstOwnerUid).toBe('a-old');
    });

    test('the founder is marked; another owner gets no Edit role or Delete on that row, and is refused', async () => {
        await addOwner('o2', 'Second');
        expect(team().firstOwnerUid).toBe('owner-1');
        AppState.currentUser = { uid: 'o2' };
        await AdminManager.loadUsers();
        const html = document.getElementById('adminActiveUsers').innerHTML;
        expect(html).toContain('Founder');
        expect(html).not.toContain("admin.showChangeRole('owner-1'");
        expect(html).not.toContain("admin.deleteUser('owner-1'");
        expect(html).toContain('Only the founder can change their own role');
        picker.mockResolvedValueOnce('manager');
        expect(await AdminManager.showChangeRole('owner-1', 'Me', 'owner')).toBe(false);
        expect(toast).toHaveBeenLastCalledWith('Only the founder can change their own role or remove themselves.', 'error');
        expect(await AdminManager.deleteUser('owner-1', 'Me')).toBe(false);
        expect(modal).not.toHaveBeenCalled();
        expect(userDoc('owner-1')).toMatchObject({ role: 'owner', status: 'active' });
        const { default: hi } = await import('../i18n/hi.js');
        expect(hi['ui.owners.founder']).toBe('पहला मालिक');
        AppState.currentUser = { uid: 'owner-1' };
    });

    test('demoting another owner sends them a bell notification in the same save; other changes do not', async () => {
        await addOwner('o2', 'Second');
        AppState.userName = 'Me';
        const notes = () => [...(fake.raw('dev_notifications')?.values() || [])];
        picker.mockResolvedValueOnce('staff');
        await AdminManager.showChangeRole('mgr', 'Ramesh', 'manager');
        expect(notes()).toEqual([]);
        picker.mockResolvedValueOnce('manager');
        await expect(AdminManager.showChangeRole('o2', 'Second', 'owner')).resolves.toBe(true);
        expect(notes()).toEqual([expect.objectContaining({
            type: 'role_change', newRole: 'manager', userId: 'o2', changedBy: 'Me', changedByUserId: 'owner-1', read: false
        })]);
        expect(notificationText(notes()[0], 'en')).toBe('👤 Me changed your role to Manager');
        expect(notificationText(notes()[0], 'hi')).toBe('👤 Me ने आपकी भूमिका बदलकर मैनेजर कर दी');
        delete AppState.userName;
    });

    test('only the founder hands Founder to another owner, after a confirmation', async () => {
        await addOwner('o2', 'Second');
        expect(document.getElementById('adminActiveUsers').innerHTML).toContain("admin.handOverFirstOwner('o2'");
        await expect(AdminManager.handOverFirstOwner('o2', 'Second')).resolves.toBe(true);
        expect(modal.mock.calls[0][0]).toContain('Second becomes the founder');
        expect(modal.mock.calls[0][3]).toMatchObject({ confirmLabel: 'Make founder', danger: true });
        expect(team().firstOwnerUid).toBe('o2');
        const html = document.getElementById('adminActiveUsers').innerHTML;
        expect(html).not.toContain('admin.handOverFirstOwner');
        expect(html).not.toContain("admin.showChangeRole('o2'");
        expect(await AdminManager.handOverFirstOwner('o2', 'Second')).toBe(false);
    });
});
