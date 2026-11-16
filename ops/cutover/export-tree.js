#!/usr/bin/env node
// Read-only full export of a Firestore project: every root collection, every
// document (including "missing" parents that only hold sub-collections) and
// every sub-collection at any depth, in backup-lib's tagged format. Also saves
// the Auth password-hash config (needed to import the users elsewhere).
// Env: FIREBASE_SERVICE_ACCOUNT. Args: --out <dir>. Prints counts only.
'use strict';
const fs = require('fs');
const path = require('path');
const tools = path.join(__dirname, '..', '..', 'tools', 'backup');
const need = (m) => require(require.resolve(m, { paths: [tools] }));
const { initializeApp, cert } = need('firebase-admin/app');
const { getFirestore } = need('firebase-admin/firestore');
const { GoogleAuth } = need('google-auth-library');
const { serialize } = require(path.join(tools, 'backup-lib.js'));

const outDir = process.argv[process.argv.indexOf('--out') + 1];
if (!outDir || process.argv.indexOf('--out') === -1) throw new Error('--out <dir> is required');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

const docs = [];
const counts = {};
let reads = 0;
const pattern = (p) => p.split('/').map((s, i) => (i % 2 ? '{id}' : s)).join('/');

async function walkCollection(col) {
    const refs = await col.listDocuments();
    reads += Math.max(1, refs.length);
    for (let i = 0; i < refs.length; i += 100) {
        const chunk = refs.slice(i, i + 100);
        const snaps = await db.getAll(...chunk);
        reads += chunk.length;
        for (const s of snaps) {
            docs.push({ path: s.ref.path, exists: s.exists, data: s.exists ? serialize(s.data()) : null });
            const key = pattern(s.ref.path);
            counts[key] = counts[key] || { docs: 0, missingParents: 0 };
            counts[key][s.exists ? 'docs' : 'missingParents'] += 1;
        }
        for (const ref of chunk) {
            const subs = await ref.listCollections();
            reads += 1;
            for (const sub of subs) await walkCollection(sub);
        }
    }
}

async function hashConfig() {
    const auth = new GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const res = await client.request({ url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/config` });
    return res.data && res.data.signIn ? res.data.signIn.hashConfig : null;
}

(async () => {
    const roots = await db.listCollections();
    reads += 1;
    for (const col of roots) await walkCollection(col);
    fs.mkdirSync(outDir, { recursive: true });
    const exportedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outDir, 'tree.json'), JSON.stringify({ format: 'happa-tree-v1', project: sa.project_id, exportedAt, docs }));
    fs.writeFileSync(path.join(outDir, 'tree-counts.json'), JSON.stringify({ project: sa.project_id, exportedAt, reads, counts }, null, 2));
    const hc = await hashConfig();
    if (!hc) throw new Error('No Auth hash config returned');
    fs.writeFileSync(path.join(outDir, 'auth-hash-config.json'), JSON.stringify(hc, null, 2));
    console.log(`Tree export of ${sa.project_id}: ${docs.length} documents (${docs.filter((d) => d.exists).length} existing), ≈${reads} reads`);
    Object.keys(counts).sort().forEach((k) => console.log(`  ${k}: ${counts[k].docs}${counts[k].missingParents ? ` (+${counts[k].missingParents} parent-only)` : ''}`));
})().catch((err) => {
    console.error(`Tree export failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
});
