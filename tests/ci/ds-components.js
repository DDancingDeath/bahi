/**
 * Component families and one home per selector (UX audit 2026-11-21, NEW-07; docs/design-system.md §7), the two
 * counts of the audit's architect scanner (analyze.py) that the per-file allowlist can't hold:
 *   dupSelectors  selectors written in more than one stylesheet (a selector list counts each part, as the scanner does)
 *   roots         per component family, the root names of the classes styled for it ("printer-sheet-head" and
 *                 "printer-sheet-body" are the one root "printer-sheet" of the dialog family)
 * tests/ds-components.json holds today's lists. A selector or root that is not listed fails (use the shared
 * component, or give the rule one home); a listed one that is gone fails until the list is lowered
 * (DS_ALLOWLIST=lower). Against the PR base the lists may only shrink, unless "exceptions" explains a new name.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const REL = 'tests/ds-components.json';
const FILE = path.join(ROOT, REL);
const ADDED = /^(#\d+|\d{4}-\d{2}-\d{2})$/;

/** The shared component to use instead of a family's own variant (docs/design-system.md §3). */
const USE = {
    button: '.btn and its variants',
    card_panel: '.panel (+ .panel-pad)',
    hero_summary_metric: '.hero / .hero-num, .metrics > .metric',
    tabs_segmented: '.tabs, .seg, .chip or .switch',
    list_table_row: '.row (.row-main, .row-title, .row-meta, .row-trail) or .table',
    empty_state: '.empty (emptyState())',
    modal_dialog_sheet: '.app-scrim > .app-dialog (.dialog / .sheet, buildSheet())',
    toast: '.toast (UIManager.showToast)',
    notice_banner: '.notice (.pos / .neg / .warn / .info, .solid, .float)',
};

const FAMILIES = {
    button: /(^|-)(btn|button|buttons)($|-)/,
    card_panel: /(card|panel|(^|-)box($|-)|tile)/,
    hero_summary_metric: /(hero|summary|(^|-)stats?($|-)|kpi|metric|overview|highlight)/,
    tabs_segmented: /((^|-)tabs?($|-)|sub-tab|(^|-)seg($|-)|filter-btn|toggle|pill|switcher|mode-btn|segmented)/,
    list_table_row: /((^|-)rows?($|-)|list-item|-item$|(^|-)entry($|-)|(^|-)table($|-))/,
    empty_state: /(empty|no-data|no-results|nothing)/,
    modal_dialog_sheet: /(modal|dialog|sheet|overlay|popup|drawer|popover|scrim)/,
    toast: /(toast|snackbar)/,
    notice_banner: /(banner|notice|alert|callout|warning-box|info-box)/,
};
const SUB = /-(head|header|title|label|value|sub|subtitle|actions|meta|body|footer|icon|wrap|main|tools|text|content|count|grid|list|close|backdrop|fallback|notes|version|amt|right|left|logo|period|formula|total|row|rows|item|cell|explain|input|reason|by|hi|tappable|light|danger|info|success|warning|purple|sm|small|wide|block|primary|wa|discard|allow|recheck|customer|date|card|cards|btns|buttons)$/;

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function stripPrint(css) {
    let out = '';
    let i = 0;
    const re = /@media\s+print[^{]*\{/gi;
    let m;
    while ((m = re.exec(css))) {
        if (m.index < i) continue;
        out += css.slice(i, m.index);
        let depth = 1;
        let j = m.index + m[0].length;
        while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
        i = j;
        re.lastIndex = j;
    }
    return out + css.slice(i);
}

/** Selectors of the style rules (inside @media / @supports too; not keyframes, @font-face or other at-rules). */
function selectors(source) {
    const css = stripPrint(stripComments(source));
    const out = [];
    let depth = 0;
    let buf = '';
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') {
            const prelude = buf.trim();
            buf = '';
            let k = i + 1;
            let d = 1;
            let nested = false;
            while (k < css.length && d) { if (css[k] === '{') { d++; nested = true; } else if (css[k] === '}') d--; k++; }
            if (prelude.startsWith('@') && nested) { depth++; continue; }
            if (!prelude.startsWith('@') && !/^(from|to|\d+%)/.test(prelude)) {
                for (const s of prelude.split(',')) if (s.trim()) out.push(s.trim().replace(/\s+/g, ' '));
            }
            i = k - 1;
        } else if (c === '}') {
            if (depth) depth--;
            buf = '';
        } else if (c === ';' && buf.trim().startsWith('@')) {
            buf = '';
        } else {
            buf += c;
        }
    }
    return out;
}

const classesIn = (sel) => [...sel.replace(/\[[^\]]*\]/g, '').matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]);

function rootOf(name) {
    let c = name.split(/__|--/)[0];
    let prev;
    while (prev !== c) {
        prev = c;
        const next = c.replace(SUB, '');
        if (next && next !== c && next.length > 2) c = next;
    }
    return c;
}

/** The stylesheets the scanner reads: www/css (not app.css, the tokens or the themes) and the /r page's own sheet. */
function cssFiles() {
    const out = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${e.name}`;
            if (e.isDirectory()) { if (!['__tests__', 'vendor', 'themes'].includes(e.name)) walk(rel); } else if (e.name.endsWith('.css')) out.push(rel);
        }
    };
    walk('www/css');
    out.push('www/r/rent-history.css');
    return out.filter((f) => !['www/css/app.css', 'www/css/variables.css'].includes(f)).sort();
}

/** { dupSelectors: { selector: [files] }, roots: { family: [roots] } } for the given { file: css } (default: the repo). */
function scan(sources = Object.fromEntries(cssFiles().map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]))) {
    const selFiles = new Map();
    const classes = new Set();
    for (const [file, css] of Object.entries(sources)) {
        for (const sel of selectors(css)) {
            if (!selFiles.has(sel)) selFiles.set(sel, new Set());
            selFiles.get(sel).add(file);
            for (const c of classesIn(sel)) classes.add(c);
        }
    }
    const dupSelectors = Object.fromEntries([...selFiles].filter(([, f]) => f.size > 1).map(([s, f]) => [s, [...f].sort()]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const roots = {};
    for (const [fam, re] of Object.entries(FAMILIES)) {
        let names = [...classes].filter((c) => re.test(c) && !c.startsWith('i-'));
        if (fam === 'card_panel') names = names.filter((c) => !c.includes('checkbox'));
        if (fam === 'tabs_segmented') names = names.filter((c) => c !== 'tab' && !c.startsWith('table') && !c.includes('tabular') && !c.includes('tablet'));
        roots[fam] = [...new Set(names.map(rootOf))].sort();
    }
    return { dupSelectors, roots };
}

const load = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

/** Names in `now` and not in `allowed` ("over"), and the other way round ("under"), as "family: name" / "selector". */
function compare(now, allowed) {
    const over = [];
    const under = [];
    const sel = new Set(allowed.dupSelectors);
    for (const s of Object.keys(now.dupSelectors)) if (!sel.has(s)) over.push(`  ${s}  (${now.dupSelectors[s].join(', ')})`);
    for (const s of allowed.dupSelectors) if (!(s in now.dupSelectors)) under.push(`  ${s}`);
    for (const fam of Object.keys(FAMILIES)) {
        const was = new Set(allowed.roots[fam] || []);
        const is = new Set(now.roots[fam] || []);
        for (const r of is) if (!was.has(r)) over.push(`  ${fam}: ${r}  (use ${USE[fam]})`);
        for (const r of was) if (!is.has(r)) under.push(`  ${fam}: ${r}`);
    }
    return { over, under };
}

/** Names the PR adds to the lists against the base, unless "exceptions" gives a reason and when it was added. */
function raisedVsBase(prior, doc) {
    const ok = (key) => {
        const e = (doc.exceptions || {})[key];
        return !!e && typeof e.reason === 'string' && e.reason.trim().length >= 20 && ADDED.test(String(e.added ?? ''));
    };
    const problems = [];
    const before = new Set(prior.dupSelectors);
    for (const s of doc.dupSelectors) if (!before.has(s) && !ok(s)) problems.push(`dupSelectors: ${s} is new (give the rule one home)`);
    if (doc.dupSelectors.length > prior.dupSelectors.length) problems.push(`dupSelectors: ${prior.dupSelectors.length} -> ${doc.dupSelectors.length}`);
    for (const fam of Object.keys(FAMILIES)) {
        const was = new Set(prior.roots[fam] || []);
        for (const r of doc.roots[fam] || []) if (!was.has(r) && !ok(`${fam}:${r}`)) problems.push(`roots ${fam}: ${r} is new (use ${USE[fam]})`);
    }
    return problems.sort();
}

/** tests/ds-components.json on the PR base (ARCH_BASE_REF, else origin/<base>), or why it can't be read. */
function baseDoc() {
    const { execFileSync } = require('child_process');
    const ref = process.env.ARCH_BASE_REF || `origin/${process.env.GITHUB_BASE_REF || 'main'}`;
    const git = (args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch (_) { return { ref, missing: 'ref' }; }
    try { return { ref, doc: JSON.parse(git(['show', `${ref}:${REL}`])) }; } catch (_) { return { ref, missing: 'file' }; }
}

function write(doc) {
    const list = (a, pad) => (a.length ? `[\n${a.map((s) => `${pad}  ${JSON.stringify(s)}`).join(',\n')}\n${pad}]` : '[]');
    const roots = Object.keys(FAMILIES).map((f) => `    ${JSON.stringify(f)}: ${list(doc.roots[f] || [], '    ')}`).join(',\n');
    const text = ['{', `  "_readme": ${JSON.stringify(doc._readme)},`, `  "exceptions": ${JSON.stringify(doc.exceptions || {})},`,
        `  "dupSelectors": ${list(doc.dupSelectors, '  ')},`, '  "roots": {', roots, '  }', '}', ''].join('\n');
    fs.writeFileSync(FILE, text);
}

/** DS_ALLOWLIST=lower: drops the listed names that are gone. */
function lower(now) {
    const doc = load();
    doc.dupSelectors = doc.dupSelectors.filter((s) => s in now.dupSelectors);
    for (const fam of Object.keys(FAMILIES)) doc.roots[fam] = (doc.roots[fam] || []).filter((r) => (now.roots[fam] || []).includes(r));
    write(doc);
}

module.exports = { REL, FAMILIES, USE, selectors, rootOf, scan, load, compare, raisedVsBase, baseDoc, write, lower };
