#!/usr/bin/env node
// seal:  node seal.js seal <dir> <recipient.pub.pem> <out.sealed>
//        Packs every file in <dir> (gzip), encrypts with a random AES-256-GCM key,
//        wraps the key with RSA-OAEP-SHA256. Only the private-key holder can open it.
// open:  node seal.js open <in.sealed> <private.pem> <outDir>
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const [cmd, a, b, c] = process.argv.slice(2);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

if (cmd === 'seal') {
    const files = {};
    const list = [];
    for (const name of fs.readdirSync(a).sort()) {
        const buf = fs.readFileSync(path.join(a, name));
        files[name] = buf.toString('base64');
        list.push({ name, bytes: buf.length, sha256: sha(buf) });
    }
    const plain = zlib.gzipSync(Buffer.from(JSON.stringify({ files, list })));
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    const wrapped = crypto.publicEncrypt({ key: fs.readFileSync(b), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
    fs.writeFileSync(c, JSON.stringify({ format: 'happa-sealed-v1', wrappedKey: wrapped.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
    list.forEach((f) => console.log(`sealed ${f.name} ${f.bytes} bytes sha256 ${f.sha256}`));
} else if (cmd === 'open') {
    const s = JSON.parse(fs.readFileSync(a, 'utf8'));
    const key = crypto.privateDecrypt({ key: fs.readFileSync(b), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(s.wrappedKey, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
    d.setAuthTag(Buffer.from(s.tag, 'base64'));
    const plain = Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]);
    const { files, list } = JSON.parse(zlib.gunzipSync(plain).toString());
    fs.mkdirSync(c, { recursive: true });
    for (const f of list) {
        const buf = Buffer.from(files[f.name], 'base64');
        if (sha(buf) !== f.sha256) throw new Error(`checksum mismatch: ${f.name}`);
        fs.writeFileSync(path.join(c, f.name), buf);
        console.log(`opened ${f.name} ${f.bytes} bytes sha256 ok`);
    }
} else {
    console.error('Usage: seal.js seal <dir> <pub.pem> <out> | open <in> <key.pem> <outDir>');
    process.exit(2);
}
