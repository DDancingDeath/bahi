#!/usr/bin/env node
// happa-bfc07 only: sets settings/app.minClientVersion so the old APKs (rc12/rc13, CLIENT_VERSION 5)
// and any cached myhappa web app stop syncing and show "app version outdated, update the app".
// Usage: node ops/myhappa/min-version.js <n>   (env FIREBASE_SERVICE_ACCOUNT). Prints old/new values only.
'use strict';
const path = require('path');
const tools = path.join(__dirname, '..', '..', 'tools', 'backup');
const need = (m) => require(require.resolve(m, { paths: [tools] }));
const { initializeApp, cert } = need('firebase-admin/app');
const { getFirestore } = need('firebase-admin/firestore');

const want = Number(process.argv[2]);
if (!Number.isInteger(want) || want < 6) throw new Error('minClientVersion must be an integer >= 6');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
if (!sa || sa.project_id !== 'happa-bfc07') throw new Error('Refusing: this script only runs against happa-bfc07');
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const ref = getFirestore().doc('settings/app');

(async () => {
    const before = (await ref.get()).data() || {};
    console.log(`settings/app.minClientVersion before: ${before.minClientVersion === undefined ? '(not set)' : before.minClientVersion}`);
    await ref.set({ minClientVersion: want }, { merge: true });
    const after = (await ref.get()).data() || {};
    console.log(`settings/app.minClientVersion after: ${after.minClientVersion}`);
    if (after.minClientVersion !== want) process.exit(1);
})().catch((err) => {
    console.error(`min-version failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
});
