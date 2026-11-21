/**
 * @jest-environment node
 */
/**
 * Every confirm dialog names its action (F50): a showModal / showModalWithHtml call with Cancel
 * (third argument `true`) passes { confirmLabel } so the button reads "Reload", "Print again"…,
 * never the generic "OK".
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'www', 'js');

function files(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) {
            if (name !== '__tests__' && name !== 'vendor') files(p, out);
        } else if (p.endsWith('.js')) out.push(p);
    }
    return out;
}

/** Top-level arguments of the call whose "(" ends at `start`. */
function callArgs(src, start) {
    const args = [];
    let cur = '';
    let depth = 1;
    let quote = null;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            cur += c;
            if (c === '\\') cur += src[++i];
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
        if ('([{'.includes(c)) depth++;
        if (')]}'.includes(c)) depth--;
        if (depth === 0) break;
        if (c === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue; }
        cur += c;
    }
    if (cur.trim()) args.push(cur.trim());
    return args;
}

function unlabelledConfirms() {
    const found = [];
    for (const file of files(ROOT)) {
        const src = fs.readFileSync(file, 'utf8');
        const re = /\bshowModal(?:WithHtml)?\s*\(/g;
        let m;
        while ((m = re.exec(src))) {
            const args = callArgs(src, re.lastIndex);
            if (args[2] !== 'true') continue;
            if (args.length > 3 && /confirmLabel/.test(args[3])) continue;
            found.push(`${path.relative(ROOT, file)}:${src.slice(0, m.index).split('\n').length}`);
        }
    }
    return found;
}

test('every confirm dialog with Cancel has a verb on its confirm button', () => {
    expect(unlabelledConfirms()).toEqual([]);
});
