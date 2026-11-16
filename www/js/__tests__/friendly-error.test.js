import { friendlyError, friendlyErrorKey } from '../utils/friendly-error.js';
import { needsInternetError, changedElsewhereError } from '../utils/write-conflict.js';
import { setLang, resetLangForTests } from '../i18n/index.js';
import en from '../i18n/en.js';
import hi from '../i18n/hi.js';

const fbError = (code, message) => Object.assign(new Error(message), { code });

describe('friendlyError (U-51): no server English in messages', () => {
    afterEach(() => { resetLangForTests(); localStorage.clear(); });

    test.each([
        [fbError('permission-denied', 'Missing or insufficient permissions.'), 'msg.error.no_access'],
        [new Error('FirebaseError: [code=permission-denied]: Missing or insufficient permissions.'), 'msg.error.no_access'],
        [fbError('unavailable', 'Failed to get document because the client is offline.'), 'msg.error.no_internet'],
        [fbError('deadline-exceeded', 'Deadline exceeded'), 'msg.error.no_internet'],
        [fbError('auth/network-request-failed', 'Firebase: Error (auth/network-request-failed).'), 'msg.error.no_internet'],
        [fbError('unauthenticated', 'Request had invalid authentication credentials.'), 'msg.error.signed_out'],
        [fbError('resource-exhausted', 'Quota exceeded.'), 'msg.error.limit_reached'],
        [fbError('failed-precondition', 'The query requires an index.'), 'msg.error.refresh_app'],
        [fbError('not-found', 'No document to update'), 'msg.error.not_found'],
        [needsInternetError(), 'msg.sync.needs_internet_write'],
        [changedElsewhereError('Settings'), 'msg.sync.changed_elsewhere'],
        [new DOMException('The quota has been exceeded.', 'QuotaExceededError'), 'msg.sync.storage_full'],
        [new Error('Cannot read properties of undefined (reading "x")'), 'msg.error.try_again'],
        ['weird', 'msg.error.try_again'],
        [null, 'msg.error.try_again']
    ])('%s → %s', (err, key) => {
        expect(friendlyErrorKey(err)).toBe(key);
    });

    test('the bill-update toast in Hindi has no English server text and gives a next step', () => {
        setLang('hi');
        const text = hi['msg.billing.failed_update_bill'].replace('{message}', friendlyError(fbError('permission-denied', 'Missing or insufficient permissions.')));
        expect(text).toBe('बिल अपडेट नहीं हुआ। आपको इसकी अनुमति नहीं है। मालिक से कहें।');
        expect(text).not.toMatch(/[A-Za-z]/);
        expect(friendlyError(fbError('unavailable', 'offline'), 'en')).toBe(en['msg.error.no_internet']);
    });
});
