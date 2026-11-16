/**
 * @fileoverview Photo of weights (#374): reads one photo with Gemini through Firebase AI Logic
 * (Gemini Developer API). No Gemini key is in the app: AI Logic uses the app's own Firebase config.
 * The modular SDK (vendor/firebase/13.2.0, the compat SDK has no AI) is imported only on the first
 * photo, as a second Firebase app; it never touches Firestore and nothing is stored.
 * App Check: used when happa.config.json has a site key (the same key as js/services/app-check.js).
 * @module firebase/photo-weights-ai
 */

import {
    OVERLOAD_RETRY_DELAYS_MS, PHOTO_WEIGHTS_MODEL, PHOTO_WEIGHTS_PROMPT, PHOTO_WEIGHTS_SCHEMA, READ_TIMEOUT_MS, isOverloadError, parseModelJson
} from '../utils/photo-weights.js';
import { appCheckSiteKey, startAppCheck } from '../services/app-check.js';

/** AI Logic enforces App Check (since 2 Nov 2026): without a token the call would only be refused. */
export const PHOTO_APP_CHECK_REQUIRED = true;
const APP_NAME = 'photo-weights';

/** @returns {Promise<[*, *, *]>} firebase-app, firebase-ai, firebase-app-check */
const loadSdk = () => Promise.all([
    import('../../vendor/firebase/13.2.0/firebase-app.js'),
    import('../../vendor/firebase/13.2.0/firebase-ai.js'),
    import('../../vendor/firebase/13.2.0/firebase-app-check.js')
]);

const defaults = () => ({
    loadSdk,
    // The running app's own config (whichever Firebase project this build points at)
    options: () => ({ ...window.firebase.app().options }),
    win: window,
    startAppCheck,
    model: PHOTO_WEIGHTS_MODEL,
    retryDelays: OVERLOAD_RETRY_DELAYS_MS
});

/** @type {?Promise<*>} */
let modelPromise = null;

async function buildModel(deps) {
    const [appSdk, ai, check] = await deps.loadSdk();
    const app = appSdk.getApps().find(a => a.name === APP_NAME) || appSdk.initializeApp(deps.options(), APP_NAME);
    let appCheck = false;
    const siteKey = appCheckSiteKey(deps.win);
    // startAppCheck makes sure reCAPTCHA is loaded and ready (and sets the localhost debug token)
    if (siteKey && await deps.startAppCheck()) {
        check.initializeAppCheck(app, { provider: new check.ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
        appCheck = true;
    }
    if (PHOTO_APP_CHECK_REQUIRED && !appCheck) throw Object.assign(new Error('App Check not started'), { code: 'app-check' });
    const service = ai.getAI(app, { backend: new ai.GoogleAIBackend(), useLimitedUseAppCheckTokens: appCheck });
    return ai.getGenerativeModel(service, {
        model: deps.model,
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: PHOTO_WEIGHTS_SCHEMA }
    }, { timeout: READ_TIMEOUT_MS });
}

/** One model per app open, built on the first photo; built again after a failure. */
function modelFor(deps) {
    if (!modelPromise) {
        modelPromise = buildModel(deps);
        modelPromise.catch(() => { modelPromise = null; });
    }
    return modelPromise;
}

/** @param {Blob} blob @returns {Promise<string>} base64 without the data: prefix */
function base64Of(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
        reader.onerror = () => reject(reader.error || new Error('photo not readable'));
        reader.readAsDataURL(blob);
    });
}

const aborted = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

/** Stops before anything is uploaded once the sheet is cancelled or timed out (no free quota used). */
function stopIfAborted(signal) {
    if (signal?.aborted) throw aborted();
}

/** Waits `ms`; rejects with an AbortError as soon as `signal` aborts. */
function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(aborted());
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(aborted());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/** One request to Gemini. */
async function generateOnce(model, blob, data, signal) {
    const call = model.generateContent([
        { text: PHOTO_WEIGHTS_PROMPT },
        { inlineData: { mimeType: blob.type || 'image/jpeg', data } }
    ], signal ? { signal } : undefined);
    // Settle at once on abort even if the SDK is slow to; the late result or error of `call` is consumed here
    return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(aborted()), { once: true });
        call.then(resolve, reject);
    });
}

/**
 * Sends one photo; resolves to the model's JSON answer (utils/photo-weights normaliseReading reads it).
 * When Gemini is overloaded (500 / 503) it tries again after each of `retryDelays` (1.5 s, then 4 s),
 * calling `onRetry(n)` first; any other error (429 daily limit, 4xx) is rejected at once as the SDK gave it.
 * Rejects with an AbortError when `signal` aborts; the request in flight and any retry still to come are dropped.
 * @param {Blob} blob - the downscaled JPEG
 * @param {{signal?: AbortSignal, deps?: Object, onRetry?: (n: number) => void}} [opts]
 * @returns {Promise<Object>}
 */
export async function readWeightsPhoto(blob, { signal, deps, onRetry } = {}) {
    stopIfAborted(signal);
    const d = { ...defaults(), ...(deps || {}) };
    const model = await modelFor(d);
    stopIfAborted(signal);
    const data = await base64Of(blob);
    const delays = d.retryDelays || [];
    for (let attempt = 0; ; attempt++) {
        stopIfAborted(signal);
        let result;
        try {
            result = await generateOnce(model, blob, data, signal);
        } catch (err) {
            if (signal?.aborted) throw aborted();
            if (attempt >= delays.length || !isOverloadError(err)) throw err;
            onRetry?.(attempt + 1);
            await wait(delays[attempt], signal);
            continue;
        }
        return parseModelJson(result.response.text());
    }
}

/** Tests only. */
export function _resetPhotoWeightsAi() {
    modelPromise = null;
}
