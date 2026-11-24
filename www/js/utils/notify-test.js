// @ts-check
/**
 * @fileoverview Settings › Notifications › Test notifications (docs/notifications.md, "How to test"):
 * the per-person limit and the result line of each test. Pure: modules/notify-tests.js does the I/O.
 * @module utils/notify-test
 */

/** Send times of this person's tests on this phone: `{uid: number[]}`. */
export const NOTIFY_TESTS_KEY = 'happa.notifyTests';
/** At most this many tests a minute per person (the push sender counts too). */
export const TEST_LIMIT = 5;
export const TEST_WINDOW_MS = 60 * 1000;
/** The local background test comes this long after the tap. */
export const TEST_LATER_MS = 15 * 1000;
/** The push sender waits this long before the closed-app test, so the app can be swiped away. */
export const TEST_PUSH_DELAY_S = 30;

/**
 * @param {?Array<*>|undefined} stamps - earlier send times (ms)
 * @param {number} now
 * @returns {{ok: boolean, waitS: number, stamps: number[]}} `stamps`: the recent ones, plus `now` when ok
 */
export function takeTestSlot(stamps, now) {
    const recent = (Array.isArray(stamps) ? stamps : []).map(Number)
        .filter(t => isFinite(t) && t <= now && now - t < TEST_WINDOW_MS).sort((a, b) => a - b);
    if (recent.length >= TEST_LIMIT) {
        return { ok: false, waitS: Math.max(1, Math.ceil((recent[0] + TEST_WINDOW_MS - now) / 1000)), stamps: recent };
    }
    return { ok: true, waitS: 0, stamps: [...recent, now] };
}

/**
 * The result line after the push sender answered (`null`: no readable answer).
 * @param {?Rec} answer - `{ok, error?, targets?, sent?, limited?}`
 * @param {{self: boolean, people?: number}} who - the push test to this person's phones, or `people` others
 * @returns {{key: string, params?: Rec}} an i18n key under `ui.notify.`
 */
export function pushResult(answer, { self, people = 0 }) {
    if (!answer) return self ? { key: 'tres_push_unknown' } : { key: 'tres_others_unknown', params: { people } };
    if (answer.ok !== true) {
        return { key: 'tres_failed', params: { reasonKey: answer.error === 'busy' ? 'treason_busy' : 'treason_sender' } };
    }
    if (answer.repeat || !Number(answer.docs)) return { key: 'tres_swept' };
    if (Number(answer.limited) > 0 && !Number(answer.targets)) return { key: 'tres_limited' };
    const targets = Number(answer.targets) || 0;
    const sent = Number(answer.sent) || 0;
    if (self) return targets ? { key: 'tres_push_done', params: { sent, targets } } : { key: 'tres_push_none' };
    return { key: targets ? 'tres_others' : 'tres_others_none', params: { people, targets, sent } };
}
