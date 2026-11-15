/**
 * @fileoverview Repository of user profiles (`users/{uid}`, docs/architecture.md
 * phase 4) for sign-in and registration: the profile read (cache first, or from
 * the server), the person's saved period ranges (#140) and the pending profile made on registration; the team directory
 * `settings/team` (#87); and each person's phone list (`deviceLog/{uid}`, #124).
 * The Users admin page goes through
 * FirebaseService (loadUsers, updateUser…).
 * @module firebase/repos/users
 */

import { workerDomain } from '../../utils/worker-accounts.js';

const userRef = (uid) => firebase.firestore()
    .collection(window.getCollection ? window.getCollection('users') : 'users').doc(uid);

const teamRef = () => firebase.firestore()
    .collection(window.getCollection ? window.getCollection('settings') : 'settings').doc('team');

/**
 * The team directory (names and roles; owner and managers may read it).
 * @returns {Promise<Object|null>} null when it was never written
 */
export async function readTeamDirectory() {
    const doc = await teamRef().get();
    return doc.exists ? doc.data() : null;
}

/**
 * Replaces the team directory (owner only in the rules).
 * @param {{people: Object}} directory
 * @returns {Promise<void>}
 */
export function writeTeamDirectory(directory) {
    return teamRef().set({ people: directory.people, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
}

const deviceLogRef = (uid) => firebase.firestore()
    .collection(window.getCollection ? window.getCollection('deviceLog') : 'deviceLog').doc(uid);

/**
 * The person's own list of phones (#124, `deviceLog/{uid}`: read by that person and the owner).
 * @param {string} uid
 * @returns {Promise<string[]|null>} null when nothing was saved yet
 */
export async function readOwnDevices(uid) {
    const doc = await deviceLogRef(uid).get();
    return doc.exists ? (doc.data().devices || []) : null;
}

/**
 * Adds a phone to the person's own list (rules: `devices` only, at most 10
 * "id:YYYYMMDD" entries): arrayUnion, so two phones adding themselves never lose
 * each other; a full list is replaced by `replaceWith` (oldest dropped).
 * @param {string} uid
 * @param {string} entry
 * @param {string[]|null} replaceWith
 * @returns {Promise<void>}
 */
export function addOwnDevice(uid, entry, replaceWith) {
    return deviceLogRef(uid).set({
        devices: replaceWith || firebase.firestore.FieldValue.arrayUnion(entry)
    }, { merge: true });
}

/**
 * One user's profile; read() reads it (with the same document reference each time).
 * @param {string} uid
 * @returns {{read: function({source?: 'server'|'cache'}=): Promise<{exists: boolean, data: (Object|undefined), fromCache: boolean}>}}
 *   read() without options: the SDK default (the offline cache when there is no connection)
 */
export function userProfile(uid) {
    const ref = userRef(uid);
    return {
        async read(options) {
            const doc = await (options ? ref.get(options) : ref.get());
            return { exists: doc.exists, data: doc.data(), fromCache: !!doc.metadata?.fromCache };
        }
    };
}

/**
 * The person's saved period ranges on their own profile (#140; rules: a short checked text).
 * Queued offline like any write.
 * @param {string} uid
 * @param {string} text encodeSavedRanges()
 * @returns {Promise<void>}
 */
export function saveOwnSavedRanges(uid, text) {
    return userRef(uid).update({ savedRanges: text });
}

/**
 * The person's app language on their own profile (U-86; rules: 'en' or 'hi'), so the next
 * person on a shared phone gets their own. Queued offline like any write.
 * @param {string} uid
 * @param {'en'|'hi'} lang
 * @returns {Promise<void>}
 */
export function saveOwnLang(uid, lang) {
    return userRef(uid).update({ lang });
}

/**
 * Changes the person's saved ranges against the profile's current list (a transaction:
 * one read), so a range saved on another phone meanwhile is kept. Needs the server.
 * @param {string} uid
 * @param {function(*): string} change the stored text (undefined when none) → the new text
 * @returns {Promise<string>} the text written
 */
export function updateOwnSavedRanges(uid, change) {
    const ref = userRef(uid);
    return firebase.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const next = change(snap.exists ? snap.data().savedRanges : undefined);
        tx.update(ref, { savedRanges: next });
        return next;
    });
}

/**
 * Creates the pending profile of a new account in a transaction (which reads from
 * the server, never the offline cache), so an existing - possibly already
 * approved - profile is never overwritten. `createdAt` is the server time.
 * @param {string} uid
 * @param {{name: string, email: string, role: string, status: string}} profile
 * @returns {Promise<boolean>} true if created, false if a profile already existed
 */
export function createProfileIfMissing(uid, profile) {
    const db = firebase.firestore();
    const ref = db.collection(window.getCollection ? window.getCollection('users') : 'users').doc(uid);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
            return false;
        }
        tx.set(ref, { ...profile, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        return true;
    });
}

/**
 * The email domain of this shop's worker accounts (U-56), from the Firebase project in use.
 * @returns {string}
 */
export function workerEmailDomain() {
    let projectId = '';
    try { projectId = firebase.app?.()?.options?.projectId || ''; } catch (_) { projectId = ''; }
    return workerDomain(projectId);
}

/**
 * Makes a worker's sign-in (U-56) without signing the owner out: the account is created in a
 * second Firebase app, which also writes the worker's own pending profile (the rules let only
 * the account itself create it); the owner then approves it like any registration. Needs the
 * internet. If the profile can't be written, the new sign-in is deleted again so the username
 * stays free.
 * @param {{email: string, password: string, name: string}} worker
 * @returns {Promise<string>} the new uid
 */
export async function createWorkerAccount({ email, password, name }) {
    const second = firebase.initializeApp(firebase.app().options, `worker-${Date.now()}`);
    try {
        if (typeof window !== 'undefined' && typeof window.happaUseEmulators === 'function') window.happaUseEmulators(second);
        const credential = await second.auth().createUserWithEmailAndPassword(email, password);
        const uid = credential.user.uid;
        try {
            await second.firestore().collection(window.getCollection ? window.getCollection('users') : 'users').doc(uid).set({
                name: String(name).slice(0, 80),
                email,
                role: 'staff',
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            await credential.user.delete().catch(() => {});
            throw error;
        }
        return uid;
    } finally {
        await second.auth().signOut().catch(() => {});
        await second.delete().catch(() => {});
    }
}

/**
 * How many people wait for approval (U-24; owner only: the rules let the owner read every profile).
 * One query of at most 20 documents.
 * @returns {Promise<number>}
 */
export async function pendingProfileCount() {
    const snap = await firebase.firestore().collection(window.getCollection ? window.getCollection('users') : 'users')
        .where('status', '==', 'pending').limit(20).get();
    return snap.size;
}
