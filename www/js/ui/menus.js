/**
 * @fileoverview ⋯ menus: a `<details>` whose `<summary>` is the ⋯ button and whose `.panel` list floats under it
 * (Billing's `.bill-menu`, Rentals' `.rent-menu`; the shared `details.menu` > `.menu-list` of surfaces.css on the Anomalies and Dues rows).
 * A pick, a tap elsewhere, Esc or Tab out closes it;
 * Up / Down move between the picks. An open list is kept inside the window and opens upwards when there is no room
 * below (above the phone's tab bar). Installed once on the document, so rows drawn later work too.
 * @module ui/menus
 */

export const MENU = 'details.bill-menu, details.rent-menu, details.menu';
const EDGE = 8;

const listOf = (menu) => menu.lastElementChild;
const picksOf = (menu) => [...(listOf(menu)?.querySelectorAll('.btn:not([hidden]):not(:disabled)') || [])];

/** Shifts an open menu's list into the window; `data-up` opens it above the ⋯ when it doesn't fit below. */
export function placeMenu(menu, win = window) {
    const list = listOf(menu);
    if (!list || !menu.open) return;
    list.removeAttribute('data-up');
    list.style.removeProperty('--menu-shift');
    const doc = win.document;
    const bar = doc.querySelector('.bottom-nav');
    const barTop = bar && bar.getClientRects().length ? bar.getBoundingClientRect().top : 0;
    const bottom = (barTop > 0 ? barTop : win.innerHeight) - EDGE;
    let r = list.getBoundingClientRect();
    const above = menu.getBoundingClientRect().top - EDGE;
    if (r.bottom > bottom && above >= r.height) {
        list.setAttribute('data-up', '');
        r = list.getBoundingClientRect();
    }
    const width = doc.documentElement.clientWidth || win.innerWidth;
    const shift = r.left < EDGE ? EDGE - r.left : r.right > width - EDGE ? width - EDGE - r.right : 0;
    if (shift) list.style.setProperty('--menu-shift', `${Math.round(shift)}px`);
}

const closeMenu = (menu, focus = false) => {
    menu.open = false;
    if (focus) menu.querySelector('summary')?.focus();
};

let installed = false;

/** Wires every ⋯ menu on the page, now and later. */
export function installMenus(doc = document) {
    if (installed) return;
    installed = true;
    const win = doc.defaultView || window;
    doc.addEventListener('toggle', (event) => {
        const menu = event.target;
        if (menu instanceof win.HTMLElement && menu.matches(MENU) && menu.open) placeMenu(menu, win);
    }, true);
    doc.addEventListener('click', (event) => {
        doc.querySelectorAll(`:is(${MENU})[open]`).forEach(menu => {
            const pick = event.target.closest?.('.btn');
            if (!menu.contains(event.target) || (pick && pick.tagName !== 'SUMMARY' && menu.contains(pick))) closeMenu(menu);
        });
    });
    doc.addEventListener('focusout', (event) => {
        const menu = event.target.closest?.(`:is(${MENU})[open]`);
        if (menu && event.relatedTarget && !menu.contains(event.relatedTarget)) closeMenu(menu);
    });
    doc.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            doc.querySelectorAll(`:is(${MENU})[open]`).forEach(menu => closeMenu(menu, true));
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const menu = event.target.closest?.(MENU);
        if (!menu) return;
        const picks = picksOf(menu);
        if (!picks.length) return;
        event.preventDefault();
        if (!menu.open) menu.open = true;
        const at = picks.indexOf(event.target);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : picks.length - 1) : (at + step + picks.length) % picks.length;
        picks[next].focus();
    });
}
