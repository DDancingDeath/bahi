// Classic async script for the start-up screen in index.html (U-25): shows it in the saved
// language and, when the app is still not up after a few seconds, a slow-internet note and
// Try again. main.js steps its text and removes it (js/ui/boot-splash.js).
(function () {
    var TEXT = {
        en: { loading: 'Loading…', slow: 'Slow internet. Keep this page open, it is still loading.', retry: 'Try again' },
        hi: { loading: 'ऐप खुल रहा है…', slow: 'इंटरनेट धीमा है। यह पेज खुला रखें, अभी खुल रहा है।', retry: 'फिर से कोशिश करें' }
    };
    var SLOW_AFTER_MS = 8000;
    var lang = 'en';
    try {
        if (localStorage.getItem('aadhat.lang') === 'hi') lang = 'hi';
    } catch (e) { /* storage blocked */ }
    var words = TEXT[lang];
    var root = document.getElementById('bootSplash');
    if (!root) return;
    var text = root.querySelector('[data-boot-text]');
    var slow = root.querySelector('[data-boot-slow]');
    var retry = root.querySelector('[data-boot-retry]');
    if (lang !== 'en') {
        root.setAttribute('lang', lang);
        if (text && !root.hasAttribute('data-boot-stepped')) text.textContent = words.loading;
        if (slow) slow.textContent = words.slow;
        if (retry) retry.textContent = words.retry;
    }
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });
    var since = (window.performance && performance.now) ? performance.now() : 0;
    setTimeout(function () {
        if (!root.isConnected) return;
        if (slow) slow.hidden = false;
        if (retry) retry.hidden = false;
    }, Math.max(0, SLOW_AFTER_MS - since));
})();
