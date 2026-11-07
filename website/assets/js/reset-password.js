// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/*
 * Catch – neues Passwort setzen (Link aus der "Passwort vergessen"-Mail).
 * Spricht direkt mit Firebase (REST); der Einmal-Code steht im Link (?oobCode=…).
 * Kein HTML aus Daten: alles wird als Text eingefügt.
 */
(function () {
  'use strict';
  var KEY = 'YOUR_FIREBASE_WEB_API_KEY'; // öffentlicher Web-Schlüssel (Projekt your-firebase-project)
  var params = new URLSearchParams(location.search);
  var code = params.get('oobCode') || '';
  var lang = (params.get('lang') || (navigator.language || 'en')).slice(0, 2) === 'de' ? 'de' : 'en';
  document.documentElement.lang = lang;
  var appUrl = 'https://app.' + location.hostname.replace(/^www\./, '');
  if (/^(localhost|127\.)/.test(location.hostname)) appUrl = '/';

  var T = {
    en: {
      title: 'Choose a new password', checking: 'Checking your link…', for: 'For your Catch account',
      pw: 'New password', pw2: 'Repeat new password', show: 'Show', hide: 'Hide', save: 'Save new password', saving: 'Saving…',
      rule: 'At least 8 characters. A longer passphrase is even better.',
      short: 'Please use at least 8 characters.', mismatch: 'The two passwords don’t match.',
      weak: 'This password is too weak. Please choose a longer one.',
      doneTitle: 'Password changed ✓', done: 'You can now sign in to Catch with your new password – in the app on your phone or in the browser.', open: 'Open Catch in the browser',
      badTitle: 'This link doesn’t work anymore', bad: 'Reset links are valid for 1 hour and only once. Request a new one in the Catch app: Sign in → “Forgot password?”.',
      disabled: 'This account is disabled.', generic: 'Something went wrong. Please try again in a moment.', offline: 'No connection. Please check your internet and try again.',
      pageTitle: 'New password – Catch',
    },
    de: {
      title: 'Neues Passwort wählen', checking: 'Dein Link wird geprüft …', for: 'Für dein Catch-Konto',
      pw: 'Neues Passwort', pw2: 'Neues Passwort wiederholen', show: 'Zeigen', hide: 'Verbergen', save: 'Neues Passwort speichern', saving: 'Wird gespeichert …',
      rule: 'Mindestens 8 Zeichen. Ein langer Satz ist noch besser.',
      short: 'Bitte mindestens 8 Zeichen verwenden.', mismatch: 'Die beiden Passwörter stimmen nicht überein.',
      weak: 'Dieses Passwort ist zu schwach. Bitte wähle ein längeres.',
      doneTitle: 'Passwort geändert ✓', done: 'Du kannst dich jetzt mit deinem neuen Passwort bei Catch anmelden – in der App auf dem Handy oder im Browser.', open: 'Catch im Browser öffnen',
      badTitle: 'Dieser Link funktioniert nicht mehr', bad: 'Links zum Zurücksetzen gelten 1 Stunde und nur einmal. Fordere in der Catch-App einen neuen an: Anmelden → „Passwort vergessen?“.',
      disabled: 'Dieses Konto ist gesperrt.', generic: 'Da ist etwas schiefgelaufen. Bitte gleich nochmal versuchen.', offline: 'Keine Verbindung. Bitte Internet prüfen und erneut versuchen.',
      pageTitle: 'Neues Passwort – Catch',
    },
  }[lang];
  document.title = T.pageTitle;

  var root = document.getElementById('reset-root');
  function h(tag, props) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.append(arguments[i]);
    return el;
  }
  function show() { while (root.firstChild) root.removeChild(root.firstChild); for (var i = 0; i < arguments.length; i++) if (arguments[i]) root.append(arguments[i]); }

  function call(body) {
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=' + KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error((d.error && d.error.message) || String(r.status)); e.firebase = true; throw e; }
        return d;
      });
    });
  }
  function bad() { show(h('h1', { text: T.badTitle }), h('p', { class: 'muted', text: T.bad })); }

  show(h('h1', { text: T.title }), h('p', { class: 'muted', text: T.checking }));
  if (!/^[\w-]{10,}$/.test(code)) return bad();

  call({ oobCode: code }).then(function (d) {
    var pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true, id: 'pw' });
    var pw2 = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true, id: 'pw2' });
    var toggle = h('button', { type: 'button', class: 'pw-toggle', text: T.show });
    toggle.addEventListener('click', function () {
      var vis = pw.type === 'password';
      pw.type = pw2.type = vis ? 'text' : 'password';
      toggle.textContent = vis ? T.hide : T.show;
    });
    var err = h('p', { class: 'reset-error', role: 'alert', hidden: true });
    var btn = h('button', { type: 'submit', class: 'btn btn-primary', text: T.save });
    var form = h('form', { novalidate: true },
      h('input', { type: 'email', autocomplete: 'username', value: d.email || '', hidden: true, readonly: true }),
      h('label', { for: 'pw', text: T.pw }), h('div', { class: 'pw-row' }, pw, toggle),
      h('label', { for: 'pw2', text: T.pw2 }), pw2,
      h('p', { class: 'muted small', text: T.rule }), err, btn);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      err.hidden = true;
      var fail = function (m) { err.textContent = m; err.hidden = false; };
      if (pw.value.length < 8) return fail(T.short);
      if (pw.value !== pw2.value) return fail(T.mismatch);
      btn.disabled = true; btn.textContent = T.saving;
      call({ oobCode: code, newPassword: pw.value }).then(function () {
        show(h('h1', { text: T.doneTitle }), h('p', { class: 'muted', text: T.done }), h('a', { class: 'btn btn-primary', href: appUrl, text: T.open }));
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = T.save;
        var m = e.message || '';
        if (/EXPIRED_OOB_CODE|INVALID_OOB_CODE/.test(m)) return bad();
        if (/WEAK_PASSWORD/.test(m)) return fail(T.weak);
        if (/USER_DISABLED/.test(m)) return fail(T.disabled);
        fail(e.firebase ? T.generic : T.offline);
      });
    });
    show(h('h1', { text: T.title }), h('p', { class: 'muted' }, T.for + ': ', h('strong', { text: d.email || '' })), form);
    pw.focus();
  }).catch(function (e) {
    if (e.firebase && /OOB_CODE/.test(e.message)) return bad();
    if (e.firebase && /USER_DISABLED/.test(e.message)) return show(h('h1', { text: T.badTitle }), h('p', { class: 'muted', text: T.disabled }));
    show(h('h1', { text: T.title }), h('p', { class: 'reset-error', text: e.firebase ? T.generic : T.offline }));
  });
})();
