#!/usr/bin/env node
/**
 * Read-only: are all composite indexes of firestore.indexes.json already live
 * (state READY) in the project? Used by firestore-rules-deploy.yml's fallback
 * path, so a key that may publish rules but not create indexes (no Cloud
 * Datastore Index Admin) does not fail a deploy whose indexes are already there.
 * Indexes that exist only in the project are ignored (never deleted here).
 *
 * Usage: node tools/ci/indexes-live.js check --project <id> --indexes firestore.indexes.json
 *          [--credentials <sa.json>]   # default $GOOGLE_APPLICATION_CREDENTIALS
 * Exit 0 when every index is live, 3 when some are missing or not READY, 1 on errors.
 */
'use strict';

const fs = require('fs');
const { getAccessToken } = require('./live-rules');

const SCOPE = 'https://www.googleapis.com/auth/datastore';

function fieldKey(f) {
    if (f.order) return `${f.fieldPath}:${f.order}`;
    if (f.arrayConfig) return `${f.fieldPath}:array-${f.arrayConfig}`;
    return `${f.fieldPath}:${f.vectorConfig ? 'vector' : '?'}`;
}

/** "group|scope|field:ORDER,..." for an index from the file or from the API. */
function indexKey(ix) {
    const fields = (ix.fields || []).filter((f) => f.fieldPath !== '__name__').map(fieldKey).join(',');
    return `${ix.collectionGroup}|${ix.queryScope || 'COLLECTION'}|${fields}`;
}

/** Repo indexes that are not READY in the live list (entries from the Firestore Admin API). */
function missingIndexes(repo, live) {
    const ready = new Set(live.filter((ix) => ix.state === 'READY').map((ix) => {
        const group = String(ix.name || '').split('/collectionGroups/')[1].split('/')[0];
        return indexKey({ ...ix, collectionGroup: group });
    }));
    return (repo.indexes || []).filter((ix) => !ready.has(indexKey(ix)));
}

async function listLive(project, sa, fetchImpl = fetch) {
    const token = await getAccessToken(sa, { fetchImpl, scope: SCOPE });
    const out = [];
    let pageToken = '';
    do {
        const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
        const res = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/-/indexes${query}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`listing indexes: HTTP ${res.status}`);
        const data = await res.json();
        out.push(...(data.indexes || []));
        pageToken = data.nextPageToken || '';
    } while (pageToken);
    return out;
}

async function main(argv) {
    if (argv[0] !== 'check') throw new Error('Usage: node tools/ci/indexes-live.js check --project <id> --indexes <file> [--credentials <sa.json>]');
    const opts = { project: '', indexes: '', credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '' };
    for (let i = 1; i < argv.length; i += 2) {
        const key = { '--project': 'project', '--indexes': 'indexes', '--credentials': 'credentials' }[argv[i]];
        if (!key) throw new Error(`Unknown argument ${argv[i]}`);
        opts[key] = argv[i + 1];
    }
    if (!opts.project || !opts.indexes || !opts.credentials) throw new Error('--project, --indexes and --credentials (or GOOGLE_APPLICATION_CREDENTIALS) are required');
    const repo = JSON.parse(fs.readFileSync(opts.indexes, 'utf8'));
    const live = await listLive(opts.project, JSON.parse(fs.readFileSync(opts.credentials, 'utf8')));
    const missing = missingIndexes(repo, live);
    if (!missing.length) {
        console.log(`All ${(repo.indexes || []).length} indexes of ${opts.indexes} are live (READY) in ${opts.project}.`);
        return 0;
    }
    console.log(`${missing.length} index(es) of ${opts.indexes} are not live (READY) in ${opts.project}:`);
    missing.forEach((ix) => console.log(`  ${indexKey(ix)}`));
    return 3;
}

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
        console.error(`indexes-live: ${err && err.message ? err.message : err}`);
        process.exit(1);
    });
}

module.exports = { indexKey, missingIndexes };
