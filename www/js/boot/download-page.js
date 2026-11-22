// /download: the language switch and the latest release's version and notes.
(function () {
    var root = document.documentElement;
    var nameIn = function (lang) { return document.querySelector('h1 .' + lang).textContent; };
    var titles = { en: nameIn('en') + ' — Download', hi: nameIn('hi') + ' — डाउनलोड' };
    var releaseNotes = null;
    var tagShown = false;
    var testBuild = false;
    var releaseDay = '';
    // The app's date format (utils/dates.js formatDay): "15 Nov 2026", Hindi month names in Hindi
    var MONTHS = {
        en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर']
    };

    function showDay(lang) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(releaseDay);
        var month = m ? MONTHS[lang === 'hi' ? 'hi' : 'en'][Number(m[2]) - 1] : '';
        document.getElementById('latestDate').textContent = month ? '(' + Number(m[3]) + ' ' + month + ' ' + m[1] + ')' : '';
    }

    function fillNotes(lang) {
        var list = document.getElementById('notesList');
        var notes = releaseNotes || {};
        var items = Array.isArray(notes[lang]) && notes[lang].length ? notes[lang] : (notes[lang === 'hi' ? 'en' : 'hi'] || []);
        list.textContent = '';
        list.lang = items === notes[lang] ? lang : (lang === 'hi' ? 'en' : 'hi');
        items.forEach(function (note) {
            var li = document.createElement('li');
            li.textContent = String(note);
            list.appendChild(li);
        });
        document.getElementById('notesSection').hidden = !list.children.length;
    }

    function show(lang) {
        root.lang = lang;
        document.title = titles[lang];
        document.querySelectorAll('[data-lang-option]').forEach(function (btn) {
            btn.setAttribute('aria-pressed', String(btn.getAttribute('data-lang-option') === lang));
        });
        var group = document.querySelector('.lang-switch');
        group.setAttribute('aria-label', lang === 'hi' ? 'भाषा' : 'Language');
        if (releaseNotes) fillNotes(lang);
        showDay(lang);
    }

    document.querySelectorAll('[data-lang-option]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var lang = btn.getAttribute('data-lang-option');
            try { localStorage.setItem('aadhat.lang', lang); } catch (e) { /* storage blocked */ }
            show(lang);
        });
    });
    show(root.lang === 'hi' ? 'hi' : 'en');

    fetch('/changelog.json', { cache: 'no-cache' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
            var latest = data && Array.isArray(data.releases) ? data.releases[0] : null;
            if (!latest || testBuild) return;
            if (!tagShown) {
                document.getElementById('latestVersion').textContent = 'v' + String(latest.version || '');
                if (latest.date) { releaseDay = String(latest.date); showDay(root.lang); }
            }
            releaseNotes = latest.notes || {};
            fillNotes(root.lang);
        })
        .catch(function () { /* page still works without notes */ });

    // The published APK's own release (e.g. v1.0.0-rc14), from the API in happa.config.json. A test app's
    // rolling pre-release (dev-latest) shows the version in its title and its own notes instead of the changelog's.
    var api = document.querySelector('meta[name="happa-release-api"]');
    if (api && /^https:\/\/api\.github\.com\/repos\//.test(api.content)) {
        fetch(api.content, { headers: { Accept: 'application/vnd.github+json' } })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (rel) {
                if (!rel) return;
                var version = null;
                if (/^v\d+\.\d+\.\d+(-rc\d+)?$/.test(String(rel.tag_name))) {
                    version = rel.tag_name;
                } else if (rel.prerelease) {
                    var m = /(\d+\.\d+\.\d+-dev\.\d+\.\d+)/.exec(String(rel.name || ''));
                    if (!m) return;
                    version = m[1];
                    testBuild = true;
                    var lines = String(rel.body || '').split(/\r?\n/)
                        .map(function (line) { return line.replace(/[*`]/g, '').trim(); })
                        .filter(Boolean);
                    releaseNotes = { en: lines };
                    fillNotes(root.lang);
                } else {
                    return;
                }
                tagShown = true;
                document.getElementById('latestVersion').textContent = version;
                var day = String(rel.published_at || '').slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(day)) { releaseDay = day; showDay(root.lang); }
            })
            .catch(function () { /* keep the changelog's version */ });
    }
})();
