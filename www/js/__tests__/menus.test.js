/**
 * ⋯ menus (ui/menus.js, NEW-19): Billing's, the Anomalies rows' and the Dues party rows' menus close on a pick, a tap elsewhere, Esc or
 * Tab out; Up / Down move between the picks; an open list stays inside the window and opens upwards near the bottom.
 */
import { installMenus, placeMenu } from '../ui/menus.js';

const menuHtml = (cls) => `<details class="${cls}"><summary class="btn btn-icon">⋯</summary>`
    + '<div class="panel"><button type="button" class="btn">Open</button><button type="button" class="btn">I corrected it</button></div></details>';

beforeAll(() => installMenus(document));

beforeEach(() => {
    document.body.innerHTML = `<p id="away" tabindex="-1">away</p>${menuHtml('menu anom-overflow')}${menuHtml('bill-menu')}${menuHtml('menu aging-more')}`;
});

const [anom, bill, dues] = [() => document.querySelector('.anom-overflow'), () => document.querySelector('.bill-menu'), () => document.querySelector('.aging-more')];
const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('closing', () => {
    test('a tap elsewhere closes every open menu; a tap inside the list but not on a pick keeps it', () => {
        anom().open = true;
        bill().open = true;
        dues().open = true;
        anom().lastElementChild.click();
        expect(anom().open).toBe(true);
        document.getElementById('away').click();
        expect(anom().open).toBe(false);
        expect(bill().open).toBe(false);
        expect(dues().open).toBe(false);
    });

    test('a pick closes it', () => {
        anom().open = true;
        anom().querySelector('.panel .btn').click();
        expect(anom().open).toBe(false);
    });

    test("Rentals' ⋯ menus (header, a property's or tenant's screen) are the same shared menu", () => {
        document.body.insertAdjacentHTML('beforeend', menuHtml('rent-menu'));
        const rent = document.querySelector('.rent-menu');
        rent.open = true;
        rent.querySelector('.panel .btn').click();
        expect(rent.open).toBe(false);
        rent.open = true;
        key(rent.querySelector('.panel .btn'), 'Escape');
        expect(rent.open).toBe(false);
    });

    test('Esc closes it and gives focus back to ⋯', () => {
        anom().open = true;
        anom().querySelector('.panel .btn').focus();
        key(document.activeElement, 'Escape');
        expect(anom().open).toBe(false);
        expect(document.activeElement).toBe(anom().querySelector('summary'));
    });

    test('Tab out of the menu closes it', () => {
        anom().open = true;
        const pick = anom().querySelector('.panel .btn');
        pick.focus();
        document.getElementById('away').focus();
        expect(anom().open).toBe(false);
    });
});

test('Down on ⋯ opens the menu on its first pick; Up / Down wrap through the picks', () => {
    const summary = anom().querySelector('summary');
    summary.focus();
    key(summary, 'ArrowDown');
    const picks = [...anom().querySelectorAll('.panel .btn')];
    expect(anom().open).toBe(true);
    expect(document.activeElement).toBe(picks[0]);
    key(picks[0], 'ArrowDown');
    expect(document.activeElement).toBe(picks[1]);
    key(picks[1], 'ArrowDown');
    expect(document.activeElement).toBe(picks[0]);
    key(picks[0], 'ArrowUp');
    expect(document.activeElement).toBe(picks[1]);
});

describe('placeMenu', () => {
    const rect = (r) => () => ({ width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, ...r, toJSON() {} });
    const win = (w, h) => ({ document, innerWidth: w, innerHeight: h });

    test('opens upwards when the list would go below the window and fits above', () => {
        const menu = anom();
        menu.open = true;
        const list = menu.lastElementChild;
        menu.getBoundingClientRect = rect({ top: 600, bottom: 644, left: 200, right: 244 });
        list.getBoundingClientRect = () => (list.hasAttribute('data-up')
            ? rect({ top: 470, bottom: 596, left: 64, right: 244 })() : rect({ top: 648, bottom: 774, left: 64, right: 244 })());
        placeMenu(menu, win(360, 700));
        expect(list.hasAttribute('data-up')).toBe(true);
        expect(list.style.getPropertyValue('--menu-shift')).toBe('');
    });

    test('stays below when it fits; moves right into the window when it starts left of it', () => {
        const menu = anom();
        menu.open = true;
        const list = menu.lastElementChild;
        menu.getBoundingClientRect = rect({ top: 100, bottom: 144, left: 60, right: 104 });
        list.getBoundingClientRect = rect({ top: 148, bottom: 274, left: -76, right: 104 });
        placeMenu(menu, win(360, 700));
        expect(list.hasAttribute('data-up')).toBe(false);
        expect(list.style.getPropertyValue('--menu-shift')).toBe('84px');
    });
});
