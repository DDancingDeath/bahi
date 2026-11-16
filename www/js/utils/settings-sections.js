// @ts-check
/**
 * @fileoverview Which Settings groups a user sees and may edit. Everyone: Appearance,
 * Printing & receipts, Billing tools, Help & about. Aadhat (internal id 'shop') for its
 * owner/manager, Rentals for its owner/manager, Team (Roles & access, People) for the owner.
 * Pure: no DOM, Firestore or AppState.
 * @module utils/settings-sections
 */

import { can } from './role-access.js';

export const BUSINESSES = Object.freeze(['shop', 'rentals']);

/** The groups in the order of the main Settings list. */
export const SETTINGS_GROUPS = Object.freeze(['appearance', 'printing', 'billing', 'shop', 'rentals', 'team', 'help']);

/** Old route sections that now live in a group (Roles & access is in Team). */
const SECTION_GROUP = Object.freeze({ roles: 'team' });

/**
 * 'owner' | 'manager' | 'member' | null: the user's role in the Aadhat business.
 * @param {*} userRole
 * @returns {?string}
 */
export function shopRoleOf(userRole) {
    if (userRole === 'owner' || userRole === 'manager') return userRole;
    return userRole === 'staff' ? 'member' : null;
}

/**
 * 'owner' | 'manager' | 'member' | null: the user's role in Rentals (the shop owner owns every business).
 * @param {*} userRole
 * @param {*} rentRole
 * @returns {?string}
 */
export function rentRoleOf(userRole, rentRole) {
    if (userRole === 'owner') return 'owner';
    return ['manager', 'member'].includes(rentRole) ? rentRole : null;
}

/** @typedef {{visible: boolean, editable: boolean}} GroupAccess */

/**
 * @param {{userRole?: string, rentRole?: string, roleAccess?: Rec}} p
 * @returns {Record<'appearance'|'printing'|'billing'|'shop'|'rentals'|'team'|'help', GroupAccess>}
 */
export function settingsView({ userRole, rentRole, roleAccess } = {}) {
    const shopRole = shopRoleOf(userRole);
    const rentalsRole = rentRoleOf(userRole, rentRole);
    const everyone = { visible: true, editable: true };
    const owner = userRole === 'owner';
    return {
        appearance: everyone,
        printing: everyone,
        billing: everyone,
        shop: {
            visible: shopRole === 'owner' || shopRole === 'manager',
            editable: shopRole === 'owner' || (shopRole === 'manager' && can('manager', 'shopSettings', roleAccess))
        },
        rentals: {
            visible: rentalsRole === 'owner' || rentalsRole === 'manager',
            editable: rentalsRole === 'owner' || rentalsRole === 'manager'
        },
        team: { visible: owner, editable: owner },
        help: everyone
    };
}

/**
 * The group a settings-* route opens (null = the main list): 'settings-roles' → Team,
 * 'settings-common' and unknown sections → the list.
 * @param {?string|undefined} section
 * @returns {?string}
 */
export function groupOf(section) {
    const s = /** @type {string} */ (section);
    const group = SECTION_GROUP[/** @type {'roles'} */ (s)] || s;
    return SETTINGS_GROUPS.includes(group) ? group : null;
}

/**
 * The group to show for a route section, or null when the user may not see it (then the list shows).
 * @param {?string|undefined} section
 * @param {ReturnType<typeof settingsView>} view
 * @returns {?string}
 */
export function shownGroup(section, view) {
    const group = groupOf(section);
    return group && view[/** @type {keyof typeof view} */ (group)]?.visible ? group : null;
}
