/**
 * @fileoverview Repository of this phone's push device doc (`users/{uid}/devices/{id}`,
 * docs/notifications.md stage 2). Only its owner reads or writes it (firestore.rules).
 * @module firebase/repos/push-devices
 */

import { getDb, col } from '../db.js';

const DEVICES = 'devices';
const deviceRef = (uid, id) => getDb().collection(col('users')).doc(uid).collection(DEVICES).doc(id);

/**
 * @param {string} uid
 * @param {string} id
 * @param {{token: string, platform: string, on: boolean, kinds: Object<string, boolean>, lang: string}} doc
 * @returns {Promise<void>}
 */
export function savePushDevice(uid, id, doc) {
    return deviceRef(uid, id).set({ ...doc, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
}

/**
 * Whether the device doc is there (the test panel's status; one read).
 * @param {string} uid
 * @param {string} id
 * @returns {Promise<?{updatedAt: ?number}>} null when missing
 */
export async function readPushDeviceDoc(uid, id) {
    const snap = await deviceRef(uid, id).get();
    if (!snap.exists) return null;
    const at = snap.data()?.updatedAt;
    return { updatedAt: at?.toMillis ? at.toMillis() : null };
}

/**
 * @param {string} uid
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deletePushDevice(uid, id) {
    return deviceRef(uid, id).delete();
}
