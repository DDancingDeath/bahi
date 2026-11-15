// /download: the language switch and the latest release's version and notes.
(function () {
    var root = document.documentElement;
    var appName = document.querySelector('h1').textContent;
    var titles = { en: appName + ' — Download', hi: appName + ' — डाउनलोड' };
    var releaseNotes = null;
    var tagShown = false;

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
            if (!latest) return;
            if (!tagShown) {
                document.getElementById('latestVersion').textContent = 'v' + String(latest.version || '');
                if (latest.date) document.getElementById('latestDate').textContent = '(' + String(latest.date) + ')';
            }
            releaseNotes = latest.notes || {};
            fillNotes(root.lang);
        })
        .catch(function () { /* page still works without notes */ });

    // The published APK's own tag (e.g. v1.0.0-rc14), from the repo the download button points at.
    var repo = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\//.exec(document.getElementById('downloadBtn').href);
    if (repo) {
        fetch('https://api.github.com/repos/' + repo[1] + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (rel) {
                if (!rel || !/^v\d+\.\d+\.\d+(-rc\d+)?$/.test(String(rel.tag_name))) return;
                tagShown = true;
                document.getElementById('latestVersion').textContent = rel.tag_name;
                var day = String(rel.published_at || '').slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(day)) document.getElementById('latestDate').textContent = '(' + day + ')';
            })
            .catch(function () { /* keep the changelog's version */ });
    }
})();
