// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/*
 * Catch Admin – reines JavaScript, keine fremden Skripte.
 * Sicherheit:
 *  - Anmeldung über Firebase (REST), danach zweiter Faktor (Authenticator-Code) auf dem Server.
 *  - Tokens nur im Arbeitsspeicher (kein localStorage) – Neuladen = neu anmelden.
 *  - Alle Inhalte von Nutzern werden als Text eingefügt (nie als HTML) → kein XSS.
 *  - Content-Security-Policy erlaubt nur Skripte von dieser Seite.
 */
(function () {
  'use strict';

  var FIREBASE_API_KEY = 'YOUR_FIREBASE_WEB_API_KEY'; // öffentlicher Web-Schlüssel (Projekt your-firebase-project)
  var IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var KIND_LABEL = { DELAY: 'Delay', CANCELLED: 'Cancelled', CROWDED: 'Crowded', DISRUPTION: 'Disruption', CHECK: 'Ticket check' };
  var CAT_LABEL = { BUG: 'Bug', IDEA: 'Idea', PRAISE: 'Praise', OTHER: 'Other' };
  var ACTION_LABEL = {
    login_ok: 'Signed in', login_fail: 'Wrong code', login_locked: 'Login locked', logout: 'Signed out', denied: 'Access denied (no admin)',
    report_hide: 'Report hidden', report_unhide: 'Report restored', report_delete: 'Report deleted',
    user_ban: 'Account banned', user_unban: 'Account unbanned', user_reset_name: 'Name reset', user_delete: 'Account data deleted',
    feedback_status: 'Feedback status', feedback_delete: 'Feedback deleted',
    report_flags_dismissed: 'Flags dismissed', user_unrestrict: 'Restriction removed', feedback_reply: 'Feedback answered',
    mail_failed: 'E-mail failed', auto_report_hide: 'Auto-hidden (users)', auto_user_throttle: 'Auto-limited reporting',
    inbox_reply: 'E-mail answered', inbox_status: 'E-mail status', inbox_delete: 'E-mail deleted', inbox_refetch: 'E-mail content reloaded',
  };
  // Moderation: Gründe (gleiche Schlüssel wie auf dem Server), Entscheidungen, Mail-Status, Vertrauen
  var REPORT_REASONS = [['WRONG', 'False or misleading'], ['SPAM', 'Spam / duplicates'], ['PERSONAL_DATA', 'Describes or exposes people'], ['INAPPROPRIATE', 'Inappropriate'], ['OTHER', 'Other']];
  var BAN_REASONS = [['REPEATED_FALSE_REPORTS', 'Repeated false reports'], ['SPAM', 'Spam'], ['PERSONAL_DATA', 'Describes or exposes people'], ['ABUSE', 'Abuse (harassment, manipulation, bots)'], ['OTHER', 'Other']];
  var REASON_LABEL = { FLAGGED: 'Flagged by several users', DISPUTED: 'Disputed by several users', REVIEWED: 'Reviewed' };
  REPORT_REASONS.concat(BAN_REASONS).forEach(function (r) { REASON_LABEL[r[0]] = r[1]; });
  var DECISION_LABEL = {
    REPORT_HIDE: 'Report hidden', REPORT_DELETE: 'Report deleted', REPORT_UNHIDE: 'Report restored', USER_BAN: 'Account banned',
    USER_UNBAN: 'Account unbanned', USER_THROTTLE: 'Reporting limited', USER_UNTHROTTLE: 'Restriction removed',
  };
  var MAIL_LABEL = {
    SENT: 'e-mail sent', NO_EMAIL: 'no e-mail address', NOT_CONFIGURED: 'e-mail not set up (Resend)', RATE_LIMITED: 'e-mail skipped (max. 5/day)',
    FAILED: 'e-mail failed', NOT_NEEDED: 'no e-mail needed', PENDING: 'e-mail pending',
  };
  var TRUST_LABEL = ['new / low', 'normal', 'trusted', 'very trusted'];

  // --- Zustand (nur im Speicher) ---------------------------------------------------------------
  var auth = null; // { idToken, refreshToken, expiresAt, email, dev }
  var session = null; // Admin-Sitzung nach dem Code
  var tab = 'overview';

  // --- DOM-Helfer: Strings werden IMMER als Text eingefügt ---------------------------------------
  function $(id) { return document.getElementById(id); }
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var toastTimer = null;
  function toast(msg, bad) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  var fmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
  function when(iso) {
    if (!iso) return '–';
    var d = new Date(iso);
    var mins = Math.round((Date.now() - d.getTime()) / 60000);
    var rel = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : Math.round(mins / 1440) + ' d ago';
    return fmt.format(d) + ' · ' + rel;
  }
  function shortId(s) { return s && s.length > 14 ? s.slice(0, 6) + '…' + s.slice(-4) : s || '–'; }

  /**
   * Kleines Formular "Grund + Notiz" (Statement of reasons, DSA Art. 17). Die betroffene Person
   * bekommt Grund und Notiz per Mail. onSubmit({ reason, note }) muss ein Promise liefern.
   */
  function reasonForm(o) {
    var select = h('select', { 'aria-label': 'Reason' }, o.reasons.map(function (r) { return h('option', { value: r[0] }, r[1]); }));
    var note = h('textarea', { rows: 2, maxlength: 300, placeholder: 'Optional note for the e-mail (max. 300 characters, no personal data)' });
    var count = h('span', { class: 'counter', text: '0 / 300' });
    note.addEventListener('input', function () { count.textContent = note.value.length + ' / 300'; });
    var panel = h('div', { class: 'panel' });
    var submit = h('button', { class: 'btn sm ' + (o.cls || 'warn'), onclick: function () {
      submit.disabled = true;
      Promise.resolve(o.onSubmit({ reason: select.value, note: note.value.trim() || undefined })).then(function () { submit.disabled = false; });
    } }, o.confirm);
    append(panel, [
      h('div', { class: 'panel-title', text: o.title }),
      h('label', null, 'Reason', select),
      h('label', null, 'Note', note), count,
      o.extra || null,
      h('p', { class: 'hint', text: o.hint || 'The person is informed automatically by e-mail (reason, note, how to object) – if they have an e-mail address.' }),
      h('div', { class: 'actions' }, submit, h('button', { class: 'btn ghost sm', onclick: function () { panel.remove(); if (o.onCancel) o.onCancel(); } }, 'Cancel')),
    ]);
    setTimeout(function () { select.focus(); }, 0);
    return panel;
  }
  function decisionText(d) {
    return (DECISION_LABEL[d.action] || d.action) + ' · ' + (REASON_LABEL[d.reason] || d.reason) + ' · ' + (d.automated ? 'automated' : 'by admin');
  }
  function decisionList(items) {
    if (!items.length) return h('p', { class: 'empty', text: 'No moderation decisions.' });
    return h('div', { class: 'list' }, items.map(function (d) {
      var r = d.report;
      return h('div', { class: 'card decision' + (d.automated ? ' auto' : '') },
        h('div', { class: 'head' },
          h('span', { class: 'pill ' + (d.automated ? 'auto-pill' : 'admin-pill') }, d.automated ? 'automated' : 'admin'),
          h('span', { class: 'title' }, DECISION_LABEL[d.action] || d.action),
          h('span', { class: 'pill mail-' + d.mailStatus }, MAIL_LABEL[d.mailStatus] || d.mailStatus)),
        h('div', { class: 'meta' }, 'Reason: ' + (REASON_LABEL[d.reason] || d.reason) + ' · ' + when(d.createdAt)),
        r ? h('div', { class: 'meta' }, (KIND_LABEL[r.kind] || r.kind) + ' · ' + (r.line || '?') + (r.headsign ? ' → ' + r.headsign : '') + ' · ' +
          [r.prevStop, r.nextStop].filter(Boolean).join(' → ') + (d.reportId ? ' · #' + d.reportId : '')) : null,
        d.detail && d.detail.until ? h('div', { class: 'meta' }, 'Until ' + when(d.detail.until)) : null,
        d.detail && d.detail.hideReports ? h('div', { class: 'meta' }, 'All reports hidden as well') : null,
        d.note ? h('div', { class: 'msg', text: d.note }) : null);
    }));
  }

  // --- Firebase (REST) ----------------------------------------------------------------------------
  function firebaseError(code) {
    if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_EMAIL/.test(code)) return 'Wrong e-mail or password.';
    if (/TOO_MANY_ATTEMPTS/.test(code)) return 'Too many attempts. Please wait a few minutes.';
    if (/USER_DISABLED/.test(code)) return 'This account is disabled.';
    return 'Sign-in failed (' + code + ').';
  }
  function signIn(email, password) {
    if (IS_LOCAL && /^dev:/.test(password)) {
      // Nur lokal (Entwicklungs-Server mit AUTH_MODE=dev): Passwort "dev:<name>"
      return Promise.resolve({ idToken: password, refreshToken: null, expiresAt: Infinity, email: email, dev: true });
    }
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password, returnSecureToken: true }),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(firebaseError((d.error && d.error.message) || String(r.status)));
        return { idToken: d.idToken, refreshToken: d.refreshToken, expiresAt: Date.now() + Number(d.expiresIn) * 1000, email: d.email };
      });
    });
  }
  function freshToken() {
    if (!auth) return Promise.reject(new Error('signed out'));
    if (auth.dev || auth.expiresAt - Date.now() > 5 * 60000) return Promise.resolve(auth.idToken);
    return fetch('https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(auth.refreshToken),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error('refresh');
        auth.idToken = d.id_token;
        auth.refreshToken = d.refresh_token;
        auth.expiresAt = Date.now() + Number(d.expires_in) * 1000;
        return auth.idToken;
      });
    });
  }

  // --- API ----------------------------------------------------------------------------------------
  function ApiError(status, code, message) { this.status = status; this.code = code; this.message = message; }
  function api(method, path, body) {
    return freshToken().then(function (token) {
      var headers = { Authorization: 'Bearer ' + token };
      if (session) headers['X-Admin-Session'] = session;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return fetch('/v1/admin' + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit' });
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new ApiError(r.status, d.error || 'error', d.message || 'Request failed (' + r.status + ').');
        return d;
      });
    }).catch(function (e) {
      if (e instanceof ApiError && e.code === 'admin_2fa_required') {
        session = null;
        showCode('Your admin session has expired. Enter a new code.');
      } else if (e instanceof ApiError && e.status === 401 && e.code === 'unauthorized') {
        logout('Your sign-in has expired. Please sign in again.');
      } else if (e instanceof ApiError && e.status === 404 && path !== '/login' && e.code === 'not_found' && !session) {
        logout('No admin access.');
      }
      throw e;
    });
  }
  // Wie act(), aber meldet zusätzlich, ob die Begründungs-Mail rausging
  function actDecision(promise, okMsg, after) {
    var msg = okMsg;
    return act(promise.then(function (d) {
      if (d && d.decision) msg = okMsg + ' · ' + (MAIL_LABEL[d.decision.mailStatus] || d.decision.mailStatus);
    }), null, function () { toast(msg, false); if (after) after(); });
  }
  function act(promise, okMsg, after) {
    return promise.then(function () { if (okMsg) toast(okMsg); if (after) after(); })
      .catch(function (e) { if (!(e instanceof ApiError && (e.code === 'admin_2fa_required' || e.code === 'unauthorized'))) toast(e.message || 'Error', true); });
  }

  // --- Anmeldung ---------------------------------------------------------------------------------
  function showLogin(msg) {
    $('app').hidden = true; $('auth').hidden = false;
    $('login-form').hidden = false; $('code-form').hidden = true;
    var err = $('login-error'); err.hidden = !msg; err.textContent = msg || '';
    $('login-password').value = '';
    setTimeout(function () { $('login-email').focus(); }, 0);
  }
  function showCode(msg) {
    $('app').hidden = true; $('auth').hidden = false;
    $('login-form').hidden = true; $('code-form').hidden = false;
    $('code-email').textContent = auth ? auth.email : '';
    var err = $('code-error'); err.hidden = !msg; err.textContent = msg || '';
    $('code-input').value = '';
    setTimeout(function () { $('code-input').focus(); }, 0);
  }
  function logout(msg) {
    var s = session, a = auth;
    session = null; auth = null;
    if (s && a) {
      // Direkt senden (nicht über api()), damit ein Fehler hier nicht wieder die Code-Abfrage öffnet
      fetch('/v1/admin/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + a.idToken, 'X-Admin-Session': s }, credentials: 'omit', cache: 'no-store' }).catch(function () {});
    }
    closeSheet();
    showLogin(msg);
  }

  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('login-submit'); btn.disabled = true;
    signIn($('login-email').value.trim(), $('login-password').value)
      .then(function (a) { auth = a; $('login-password').value = ''; showCode(); })
      .catch(function (e) { showLogin(e.message); })
      .then(function () { btn.disabled = false; });
  });
  $('code-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('code-submit'); btn.disabled = true;
    api('POST', '/login', { code: $('code-input').value.replace(/\s+/g, '') })
      .then(function (d) { session = d.session; startApp(); })
      .catch(function (e) {
        if (e instanceof ApiError && e.status === 404) return logout('This account has no admin access. (Owner: is 2FA set up? sudo catch-admin 2fa)');
        if (auth) showCode(e.message);
      })
      .then(function () { btn.disabled = false; });
  });
  $('code-cancel').addEventListener('click', function () { logout(); });
  $('logout').addEventListener('click', function () { logout('Signed out.'); });

  // --- Oberfläche --------------------------------------------------------------------------------
  function startApp() {
    $('auth').hidden = true; $('app').hidden = false;
    $('who-email').textContent = auth.email || '';
    selectTab(tab);
  }
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
    b.addEventListener('click', function () { selectTab(b.getAttribute('data-tab')); });
  });
  function selectTab(name) {
    tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var c = $('content'); clear(c);
    ({ overview: renderOverview, reports: renderReports, users: renderUsers, feedback: renderFeedback, inbox: renderInbox, audit: renderAudit })[name](c);
    window.scrollTo(0, 0);
  }
  function setBadge(id, n) { var b = $(id); b.hidden = !n; b.textContent = n ? String(n) : ''; }

  // Übersicht
  function renderOverview(c) {
    c.append(h('p', { class: 'muted', text: 'Loading…' }));
    api('GET', '/overview').then(function (o) {
      clear(c);
      setBadge('badge-flagged', o.reports.flagged);
      setBadge('badge-feedback', o.feedback.new);
      setBadge('badge-inbox', o.inbox.new);
      function tile(n, label, cls) { return h('div', { class: 'tile' + (cls ? ' ' + cls : '') }, h('b', { text: n }), h('span', { text: label })); }
      c.append(
        h('h2', { text: 'Needs attention' }),
        h('div', { class: 'tiles' },
          tile(o.reports.flagged, 'flagged reports', o.reports.flagged ? 'alert' : 'good'),
          tile(o.feedback.new, 'new feedback', o.feedback.new ? 'alert' : 'good'),
          tile(o.inbox.new, o.inbox.enabled ? 'new e-mails' : 'new e-mails (receiving off)', o.inbox.new ? 'alert' : 'good'),
          o.inbox.fetchFailed ? tile(o.inbox.fetchFailed, 'e-mails without content', 'alert') : null),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn warn sm', onclick: function () { reportState.view = 'flagged'; selectTab('reports'); } }, 'Review flagged reports'),
          h('button', { class: 'btn ok sm', onclick: function () { fbState.status = 'NEW'; selectTab('feedback'); } }, 'Read new feedback'),
          h('button', { class: 'btn ok sm', onclick: function () { inboxState.status = 'NEW'; selectTab('inbox'); } }, 'Open inbox')),
        h('h2', { class: 'section', text: 'Accounts' }),
        h('div', { class: 'tiles' }, tile(o.users.total, 'accounts'), tile(o.users.new7d, 'new (7 days)'), tile(o.users.active24h, 'active (24 h)'), tile(o.users.banned, 'banned')),
        h('h2', { class: 'section', text: 'Reports' }),
        h('div', { class: 'tiles' }, tile(o.reports.total, 'total'), tile(o.reports.last24h, 'last 24 h'), tile(o.reports.hidden, 'hidden'), tile(o.trackingsActive, 'live trackings'), tile(o.devices, 'push devices')),
        h('div', { class: 'row-actions' }, Object.keys(KIND_LABEL).map(function (k) {
          return h('span', { class: 'pill ' + k }, KIND_LABEL[k] + ' · ' + (o.reports.byKind24h[k] || 0) + ' (24 h)');
        })),
      );
    }).catch(function (e) { clear(c); c.append(h('p', { class: 'error', text: e.message })); });
  }

  // Hinweise
  var reportState = { view: 'flagged', kind: '', q: '' };
  function renderReports(c) {
    var list = h('div', { class: 'list' });
    var more = h('div', { class: 'more' });
    var search = h('input', { type: 'search', placeholder: 'Line, stop or report ID', value: reportState.q });
    var kind = h('select', { 'aria-label': 'Kind' }, h('option', { value: '' }, 'All kinds'),
      Object.keys(KIND_LABEL).map(function (k) { var o = h('option', { value: k }, KIND_LABEL[k]); if (reportState.kind === k) o.selected = true; return o; }));
    var seg = h('div', { class: 'seg' }, [['flagged', 'Flagged'], ['recent', 'Recent'], ['hidden', 'Hidden']].map(function (v) {
      return h('button', { class: reportState.view === v[0] ? 'active' : '', onclick: function () { reportState.view = v[0]; selectTab('reports'); } }, v[1]);
    }));
    var t;
    search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { reportState.q = search.value.trim(); load(0); }, 350); });
    kind.addEventListener('change', function () { reportState.kind = kind.value; load(0); });
    c.append(h('div', { class: 'filters' }, seg, kind, search), list, more);

    function load(offset) {
      if (offset === 0) { clear(list); list.append(h('p', { class: 'muted', text: 'Loading…' })); }
      var qs = '?view=' + reportState.view + '&limit=30&offset=' + offset +
        (reportState.kind ? '&kind=' + reportState.kind : '') + (reportState.q ? '&q=' + encodeURIComponent(reportState.q) : '');
      api('GET', '/reports' + qs).then(function (d) {
        if (offset === 0) clear(list);
        if (offset === 0 && d.items.length === 0) list.append(h('p', { class: 'empty', text: reportState.view === 'flagged' ? 'Nothing flagged. 🎉' : 'No reports.' }));
        d.items.forEach(function (r) { list.append(reportCard(r, function () { load(0); })); });
        clear(more);
        if (d.hasMore) more.append(h('button', { class: 'btn ghost sm', onclick: function () { load(offset + 30); } }, 'Load more'));
      }).catch(function (e) { clear(list); list.append(h('p', { class: 'error', text: e.message })); });
    }
    load(0);
  }

  function reportCard(r, reload) {
    var line = r.line ? r.line.name : r.lineKey;
    var stops = [r.prevStop, r.nextStop].filter(Boolean).join(' → ');
    var card = h('div', { class: 'card' + (r.hidden ? ' dim' : '') },
      h('div', { class: 'head' },
        h('span', { class: 'pill ' + r.kind }, KIND_LABEL[r.kind] || r.kind),
        h('span', { class: 'title' }, line + (r.headsign ? ' → ' + r.headsign : '')),
        r.flags ? h('span', { class: 'pill flag' }, '⚑ ' + r.flags + ' flag' + (r.flags === 1 ? '' : 's')) : null,
        r.hidden ? h('span', { class: 'pill hidden-pill' }, 'hidden') : null),
      h('div', { class: 'meta' }, (stops || 'no stops') + ' · ' + when(r.reportedAt) + ' · #' + r.id),
      h('div', { class: 'meta' }, 'Tags: ' + (r.tags.length ? r.tags.join(', ') : '–') + ' · 👍 ' + r.confirmations + ' · 👎 ' + r.denials +
        ' · reporter trust: ' + (TRUST_LABEL[r.reporterTrust] || '–') + (r.alertsHeld ? ' · alerts held until confirmed' : '') + (r.reviewedAt ? ' · reviewed' : '')),
      r.flagReasons.length ? h('div', { class: 'meta' }, 'Flag reasons: ' + r.flagReasons.map(function (f) { return f.reason; }).join(', ')) : null,
      h('div', { class: 'meta' }, 'By: ', r.user
        ? h('button', { class: 'link', onclick: function () { openUser(r.user.uid); } }, (r.user.name || 'no name') + ' (' + shortId(r.user.uid) + ')' + (r.user.banned ? ' – banned' : ''))
        : 'deleted account'),
      h('div', { class: 'actions' },
        r.hidden
          ? h('button', { class: 'btn ok sm', onclick: function () { act(api('POST', '/reports/' + r.id + '/unhide'), 'Restored', reload); } }, 'Restore')
          : h('button', { class: 'btn warn sm', onclick: function () { openForm('hide'); } }, 'Hide…'),
        r.flags && !r.hidden ? h('button', { class: 'btn ghost sm', onclick: function () { act(api('POST', '/reports/' + r.id + '/unhide'), 'Flags dismissed', reload); } }, 'Dismiss flags') : null,
        h('button', { class: 'btn danger sm', onclick: function () { openForm('delete'); } }, 'Delete…')));
    var form = null;
    function openForm(kind) {
      if (form) form.remove();
      form = reasonForm({
        title: kind === 'hide' ? 'Hide report #' + r.id : 'Delete report #' + r.id + ' permanently',
        confirm: kind === 'hide' ? 'Hide report' : 'Delete report',
        cls: kind === 'hide' ? 'warn' : 'danger',
        reasons: REPORT_REASONS,
        hint: r.user
          ? (r.user.email ? 'The reporter gets an e-mail with the reason, your note and how to object.' : 'The reporter has no e-mail address – the decision is only logged.')
          : 'The account was deleted – the decision is only logged.',
        onSubmit: function (v) {
          var req = kind === 'hide' ? api('POST', '/reports/' + r.id + '/hide', v) : api('DELETE', '/reports/' + r.id, v);
          return actDecision(req, kind === 'hide' ? 'Hidden' : 'Deleted', reload);
        },
        onCancel: function () { form = null; },
      });
      card.append(form);
    }
    return card;
  }

  // Konten
  var userState = { q: '', filter: 'all' };
  function renderUsers(c) {
    var list = h('div', { class: 'list' });
    var more = h('div', { class: 'more' });
    var search = h('input', { type: 'search', placeholder: 'Name, e-mail or user ID', value: userState.q });
    var seg = h('div', { class: 'seg' }, [['all', 'All'], ['flagged', 'Flagged'], ['restricted', 'Limited'], ['banned', 'Banned']].map(function (v) {
      return h('button', { class: userState.filter === v[0] ? 'active' : '', onclick: function () { userState.filter = v[0]; selectTab('users'); } }, v[1]);
    }));
    var t;
    search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { userState.q = search.value.trim(); load(0); }, 350); });
    c.append(h('div', { class: 'filters' }, seg, search), list, more);
    function load(offset) {
      if (offset === 0) { clear(list); list.append(h('p', { class: 'muted', text: 'Loading…' })); }
      api('GET', '/users?filter=' + userState.filter + '&limit=30&offset=' + offset + (userState.q ? '&q=' + encodeURIComponent(userState.q) : ''))
        .then(function (d) {
          if (offset === 0) clear(list);
          if (offset === 0 && d.items.length === 0) list.append(h('p', { class: 'empty', text: 'No accounts.' }));
          d.items.forEach(function (u) {
            list.append(h('div', { class: 'card' },
              h('div', { class: 'head' },
                h('button', { class: 'link title', onclick: function () { openUser(u.uid, function () { load(0); }); } }, u.name || 'no name'),
                u.banned ? h('span', { class: 'pill banned' }, 'banned') : null,
                u.restrictedUntil ? h('span', { class: 'pill restricted' }, 'reporting limited') : null,
                u.flagsReceived ? h('span', { class: 'pill flag' }, '⚑ ' + u.flagsReceived) : null),
              h('div', { class: 'meta' }, (u.email || 'no e-mail') + ' · ' + shortId(u.uid)),
              h('div', { class: 'meta' }, u.reports + ' reports · last seen ' + when(u.lastSeenAt))));
          });
          clear(more);
          if (d.hasMore) more.append(h('button', { class: 'btn ghost sm', onclick: function () { load(offset + 30); } }, 'Load more'));
        }).catch(function (e) { clear(list); list.append(h('p', { class: 'error', text: e.message })); });
    }
    load(0);
  }

  function closeSheet() { $('sheet').hidden = true; clear($('sheet-body')); document.body.style.overflow = ''; }
  $('sheet').addEventListener('click', function (ev) { if (ev.target === $('sheet')) closeSheet(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeSheet(); });

  function openUser(uid, onChange, back) {
    var body = $('sheet-body');
    clear(body); body.append(h('p', { class: 'muted', text: 'Loading…' }));
    $('sheet').hidden = false; document.body.style.overflow = 'hidden';
    var refresh = function () { if (onChange) onChange(); openUser(uid, onChange, back); };
    api('GET', '/users/' + encodeURIComponent(uid)).then(function (d) {
      var u = d.user;
      clear(body);
      var hideAll = h('input', { type: 'checkbox' });
      var delReports = h('input', { type: 'checkbox' });
      var tr = d.trust, ti = tr.inputs;
      var banBox = h('div', null);
      var openBan = function () {
        clear(banBox);
        banBox.append(reasonForm({
          title: 'Ban this account',
          confirm: 'Ban account',
          reasons: BAN_REASONS,
          extra: h('label', { class: 'check' }, hideAll, 'Also hide all reports of this account'),
          hint: u.email ? 'They can no longer report, vote or use live tracking. They get an e-mail with the reason, your note and how to object.' : 'They can no longer report, vote or use live tracking. No e-mail address – the decision is only logged.',
          onSubmit: function (v) {
            v.hideReports = hideAll.checked;
            return actDecision(api('POST', '/users/' + encodeURIComponent(uid) + '/ban', v), 'Account banned', refresh);
          },
        }));
      };
      append(body, [
        h('div', { class: 'head' }, h('h2', { text: u.name || 'no name' }), u.banned ? h('span', { class: 'pill banned' }, 'banned') : null,
          u.restrictedUntil ? h('span', { class: 'pill restricted' }, 'reporting limited') : null,
          d.isAdmin ? h('span', { class: 'pill new' }, 'admin') : null),
        h('dl', { class: 'kv' },
          h('dt', { text: 'User ID' }), h('dd', { class: 'mono', text: u.uid }),
          h('dt', { text: 'E-mail' }), h('dd', { text: u.email || '–' }),
          h('dt', { text: 'Registered' }), h('dd', { text: when(u.createdAt) }),
          h('dt', { text: 'Last seen' }), h('dd', { text: when(u.lastSeenAt) }),
          h('dt', { text: 'Terms accepted' }), h('dd', { text: u.termsAcceptedAt ? when(u.termsAcceptedAt) : 'no' }),
          h('dt', { text: 'Language' }), h('dd', { text: u.lang || '–' }),
          h('dt', { text: 'Reports' }), h('dd', { text: u.reports + ' (' + u.reportsHidden + ' hidden) · flags received: ' + u.flagsReceived }),
          h('dt', { text: 'Push devices' }), h('dd', { text: String(u.devices) }),
          h('dt', { text: 'Feedback sent' }), h('dd', { text: String(u.feedback) }),
          h('dt', { text: 'Trust' }), h('dd', { text: TRUST_LABEL[tr.level] + ' (level ' + tr.level + ', score ' + tr.score + ')' + (tr.negative ? ' – alerts held until confirmed, votes count half' : '') }),
          h('dt', { text: 'Last 90 days' }), h('dd', { text: '👍 ' + ti.confirmations + ' · 👎 ' + ti.denials + ' · ⚑ ' + ti.flags + ' · hidden/deleted ' + ti.hidden + ' · visible reports ' + ti.reports + ' · account ' + ti.accountAgeDays + ' days' }),
          h('dt', { text: 'Reporting' }), h('dd', { text: u.restrictedUntil ? 'Limited until ' + when(u.restrictedUntil) + ' (3 per day, 1 per 30 min)' : 'normal limits' })),
        u.restrictedUntil ? h('div', { class: 'actions' }, h('button', { class: 'btn ok sm', onclick: function () {
          if (confirm('Remove the reporting limit of this account? They get a short e-mail.')) actDecision(api('POST', '/users/' + encodeURIComponent(uid) + '/unrestrict'), 'Restriction removed', refresh);
        } }, 'Remove restriction')) : null,
        d.isAdmin ? h('div', { class: 'note', text: 'This is an admin account – it can’t be banned or deleted here.' }) : [
          u.banned
            ? h('div', { class: 'actions' }, h('button', { class: 'btn ok', onclick: function () {
                if (confirm('Unban this account? They get a short "your account is active again" e-mail.')) actDecision(api('POST', '/users/' + encodeURIComponent(uid) + '/unban'), 'Account unbanned', refresh);
              } }, 'Unban'))
            : h('div', null, h('div', { class: 'actions' }, h('button', { class: 'btn warn', onclick: openBan }, 'Ban account…')), banBox),
          h('div', { class: 'actions' },
            h('button', { class: 'btn ghost sm', onclick: function () {
              if (confirm('Reset the display name of this account?')) act(api('POST', '/users/' + encodeURIComponent(uid) + '/reset-name'), 'Name reset', refresh);
            } }, 'Reset display name')),
          h('div', { class: 'note', text: 'Deleting removes the Catch data of this account (devices, trackings, votes; reports stay anonymous unless you tick the box). The Firebase login itself stays – it may be used by other apps in the same project. To keep someone out for good, ban instead.' }),
          h('label', { class: 'check' }, delReports, 'Also delete all reports of this account'),
          h('div', { class: 'actions' }, h('button', { class: 'btn danger', onclick: function () {
            if (confirm('Delete the Catch data of this account? This cannot be undone.')) {
              act(api('DELETE', '/users/' + encodeURIComponent(uid) + '?deleteReports=' + (delReports.checked ? 'true' : 'false')), 'Account data deleted', function () { closeSheet(); if (onChange) onChange(); });
            }
          } }, 'Delete account data')),
        ],
        h('h2', { class: 'section', text: 'Moderation decisions (' + d.decisions.length + ')' }),
        decisionList(d.decisions),
        h('h2', { class: 'section', text: 'Reports (' + d.reports.length + (u.reports > d.reports.length ? ' of ' + u.reports : '') + ')' }),
        d.reports.length ? h('div', { class: 'list' }, d.reports.map(function (r) { return reportCard(r, refresh); })) : h('p', { class: 'empty', text: 'No reports.' }),
        h('div', { class: 'more' }, back ? h('button', { class: 'btn ghost', onclick: back }, '← Back to e-mail') : null, h('button', { class: 'btn ghost', onclick: closeSheet }, 'Close')),
      ]);
    }).catch(function (e) { clear(body); body.append(h('p', { class: 'error', text: e.message }), h('button', { class: 'btn ghost', onclick: closeSheet }, 'Close')); });
  }

  // Feedback
  var fbState = { status: 'NEW' };
  function renderFeedback(c) {
    var list = h('div', { class: 'list' });
    var more = h('div', { class: 'more' });
    var seg = h('div', { class: 'seg' }, [['NEW', 'New'], ['READ', 'Read'], ['DONE', 'Done'], ['', 'All']].map(function (v) {
      return h('button', { class: fbState.status === v[0] ? 'active' : '', onclick: function () { fbState.status = v[0]; selectTab('feedback'); } }, v[1]);
    }));
    c.append(h('div', { class: 'filters' }, seg), list, more);
    function load(offset) {
      if (offset === 0) { clear(list); list.append(h('p', { class: 'muted', text: 'Loading…' })); }
      api('GET', '/feedback?limit=30&offset=' + offset + (fbState.status ? '&status=' + fbState.status : '')).then(function (d) {
        if (offset === 0) clear(list);
        if (offset === 0 && d.items.length === 0) list.append(h('p', { class: 'empty', text: 'No feedback here.' }));
        d.items.forEach(function (f) {
          var setStatus = function (s, msg) { act(api('PATCH', '/feedback/' + f.id, { status: s }), msg, function () { load(0); refreshBadges(); }); };
          var replyBox = h('div', null);
          var openReply = function () {
            clear(replyBox);
            var text = h('textarea', { rows: 6, maxlength: 3000, placeholder: 'Your reply – it is sent by e-mail with the original feedback quoted and signed "The Catch team".' });
            var count = h('span', { class: 'counter', text: '0 / 3000' });
            text.addEventListener('input', function () { count.textContent = text.value.length + ' / 3000'; });
            var send = h('button', { class: 'btn primary sm', onclick: function () {
              if (!text.value.trim()) { text.focus(); return; }
              send.disabled = true;
              act(api('POST', '/feedback/' + f.id + '/reply', { message: text.value }), 'Reply sent to ' + f.user.email, function () { load(0); refreshBadges(); })
                .then(function () { send.disabled = false; });
            } }, 'Send reply');
            replyBox.append(h('div', { class: 'panel' },
              h('div', { class: 'panel-title', text: 'Reply to ' + f.user.email + ' (' + (f.lang === 'de' ? 'German' : 'English') + ' e-mail)' }),
              text, count,
              h('div', { class: 'actions' }, send, h('button', { class: 'btn ghost sm', onclick: function () { clear(replyBox); } }, 'Cancel'))));
            setTimeout(function () { text.focus(); }, 0);
          };
          list.append(h('div', { class: 'card' },
            h('div', { class: 'head' },
              h('span', { class: 'pill' }, CAT_LABEL[f.category] || f.category),
              f.rating ? h('span', { class: 'stars', 'aria-label': f.rating + ' of 5 stars' }, '★★★★★'.slice(0, f.rating) + '☆☆☆☆☆'.slice(0, 5 - f.rating)) : null,
              f.status === 'NEW' ? h('span', { class: 'pill new' }, 'new') : h('span', { class: 'pill hidden-pill' }, f.status.toLowerCase())),
            h('div', { class: 'msg', text: f.message }),
            h('div', { class: 'meta' }, when(f.createdAt) + ' · ' + [f.platform, f.appVersion, f.lang].filter(Boolean).join(' · ')),
            h('div', { class: 'meta' }, 'From: ', f.user
              ? h('button', { class: 'link', onclick: function () { openUser(f.user.uid); } }, (f.user.name || 'no name') + ' (' + shortId(f.user.uid) + ')')
              : 'anonymous',
              f.user && f.user.email ? ' · ' + f.user.email : null),
            (f.replies || []).map(function (rp) {
              return h('div', { class: 'reply' }, h('div', { class: 'reply-head', text: 'Your reply · ' + when(rp.at) }), h('div', { class: 'msg', text: rp.message }));
            }),
            f.canReply ? null : h('div', { class: 'meta why', text: !f.user ? 'No reply possible: sent anonymously.' : !f.allowContact ? 'No reply possible: the person did not allow a reply by e-mail.' : 'No reply possible: the account has no e-mail address.' }),
            replyBox,
            h('div', { class: 'actions' },
              f.canReply ? h('button', { class: 'btn primary sm', onclick: function () { openReply(); } }, (f.replies && f.replies.length) ? 'Reply again' : 'Reply') : null,
              f.status !== 'READ' ? h('button', { class: 'btn ghost sm', onclick: function () { setStatus('READ', 'Marked as read'); } }, f.status === 'NEW' ? 'Mark read' : 'Reopen') : null,
              f.status !== 'DONE' ? h('button', { class: 'btn ok sm', onclick: function () { setStatus('DONE', 'Done'); } }, 'Done') : null,
              h('button', { class: 'btn danger sm', onclick: function () {
                if (confirm('Delete this feedback?')) act(api('DELETE', '/feedback/' + f.id), 'Deleted', function () { load(0); refreshBadges(); });
              } }, 'Delete'))));
        });
        clear(more);
        if (d.hasMore) more.append(h('button', { class: 'btn ghost sm', onclick: function () { load(offset + 30); } }, 'Load more'));
      }).catch(function (e) { clear(list); list.append(h('p', { class: 'error', text: e.message })); });
    }
    load(0);
  }
  // Postfach: empfangene E-Mails (Resend). Inhalte sind reiner Text und werden nur als Text eingefügt.
  var MAIL_STATUS_LABEL = { NEW: 'new', READ: 'read', DONE: 'done', SPAM: 'spam' };
  var inboxState = { status: 'NEW', q: '' };
  function mailStatusPill(s) {
    return h('span', { class: 'pill ' + (s === 'NEW' ? 'new' : s === 'SPAM' ? 'spam' : 'hidden-pill') }, MAIL_STATUS_LABEL[s] || s);
  }
  function authPill(m) {
    if (!m.authWarnings || !m.authWarnings.length) return null;
    var what = m.authWarnings.map(function (k) { return k.toUpperCase(); }).join(' / ');
    return h('span', { class: 'pill auth-warn', title: what + ' check failed – the sender may be forged' }, '⚠ ' + what);
  }
  function contentPill(m) {
    if (m.contentStatus === 'FETCHED') return null;
    return m.contentStatus === 'FETCH_FAILED' ? h('span', { class: 'pill mail-FAILED' }, 'content missing') : h('span', { class: 'pill mail-PENDING' }, 'loading content…');
  }
  function fmtSize(n) {
    if (typeof n !== 'number') return '? KB';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function reSubject(s) {
    s = (s || '').trim();
    if (!s) return 'Re: Your message to Catch';
    return /^\s*(re|aw|antw|sv|vs)\s*(\[\d+\]|\(\d+\))?\s*:/i.test(s) ? s : 'Re: ' + s;
  }

  function renderInbox(c) {
    var list = h('div', { class: 'list' });
    var more = h('div', { class: 'more' });
    var note = h('div', null);
    var search = h('input', { type: 'search', placeholder: 'Sender, subject or text', 'aria-label': 'Search e-mails', value: inboxState.q });
    var seg = h('div', { class: 'seg' }, [['NEW', 'New'], ['READ', 'Read'], ['DONE', 'Done'], ['SPAM', 'Spam'], ['', 'All']].map(function (v) {
      return h('button', { class: inboxState.status === v[0] ? 'active' : '', onclick: function () { inboxState.status = v[0]; selectTab('inbox'); } }, v[1]);
    }));
    var t;
    search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { inboxState.q = search.value.trim(); load(0); }, 350); });
    c.append(h('div', { class: 'filters' }, seg, search), note, list, more);
    function reload() { load(0); refreshBadges(); }
    function load(offset) {
      if (offset === 0) { clear(list); list.append(h('p', { class: 'muted', text: 'Loading…' })); }
      api('GET', '/inbox?limit=30&offset=' + offset + (inboxState.status ? '&status=' + inboxState.status : '') + (inboxState.q ? '&q=' + encodeURIComponent(inboxState.q) : ''))
        .then(function (d) {
          clear(note);
          if (!d.enabled) note.append(h('div', { class: 'note', text: 'Receiving e-mails is not set up on the server (RESEND_WEBHOOK_SECRET is missing) – see docs/ADMIN.md. E-mails received earlier are still listed.' }));
          if (offset === 0) clear(list);
          if (offset === 0 && d.items.length === 0) list.append(h('p', { class: 'empty', text: inboxState.status === 'NEW' ? 'No new e-mails. 🎉' : 'No e-mails here.' }));
          d.items.forEach(function (m) { list.append(mailCard(m, function () { openMail(m.id, reload); })); });
          clear(more);
          if (d.hasMore) more.append(h('button', { class: 'btn ghost sm', onclick: function () { load(offset + 30); } }, 'Load more'));
        }).catch(function (e) { clear(list); list.append(h('p', { class: 'error', text: e.message })); });
    }
    load(0);
  }

  function mailCard(m, open) {
    var name = m.from.name || m.from.address || 'Unknown sender';
    return h('div', { class: 'card mail' + (m.status === 'NEW' ? ' unread' : '') + (m.status === 'SPAM' ? ' dim' : ''), onclick: open },
      h('div', { class: 'head' },
        h('button', { class: 'link title', onclick: function (ev) { ev.stopPropagation(); open(); } }, name),
        mailStatusPill(m.status),
        authPill(m),
        m.attachmentCount ? h('span', { class: 'pill', title: m.attachmentCount + ' attachment(s)' }, '📎 ' + m.attachmentCount) : null,
        m.autoReply ? h('span', { class: 'pill hidden-pill' }, 'auto-reply') : null,
        m.replies ? h('span', { class: 'pill mail-SENT' }, '↩ answered') : null,
        contentPill(m)),
      h('div', { class: 'subject', text: m.subject || '(no subject)' }),
      m.snippet ? h('div', { class: 'snippet', text: m.snippet }) : null,
      h('div', { class: 'meta' },
        (m.from.name && m.from.address ? m.from.address + ' · ' : '') + when(m.receivedAt),
        m.user ? h('span', { class: 'pill user-pill' }, '👤 ' + (m.user.name || 'Catch account') + (m.user.banned ? ' · banned' : '')) : null));
  }

  function openMail(id, onChange) {
    var body = $('sheet-body');
    clear(body); body.append(h('p', { class: 'muted', text: 'Loading…' }));
    $('sheet').hidden = false; document.body.style.overflow = 'hidden';
    var reopen = function () { openMail(id, onChange); };
    api('GET', '/inbox/' + encodeURIComponent(id)).then(function (d) {
      if (onChange) onChange(); // NEU → GELESEN
      var m = d.mail;
      clear(body);
      var setStatus = function (s, msg) { act(api('PATCH', '/inbox/' + encodeURIComponent(id), { status: s }), msg, reopen); };
      var auth = m.auth || {};
      var authRow = h('dd', { class: 'checks' }, ['spf', 'dkim', 'dmarc'].map(function (k) {
        var v = auth[k] || 'none';
        var bad = m.authWarnings.indexOf(k) >= 0;
        return h('span', { class: 'pill ' + (bad ? 'auth-warn' : v === 'pass' ? 'mail-SENT' : 'hidden-pill') }, k.toUpperCase() + ' ' + v);
      }));
      var kv = h('dl', { class: 'kv' },
        h('dt', { text: 'From' }), h('dd', null, m.from.name ? h('b', { text: m.from.name }) : null, m.from.name ? ' ' : null, h('span', { class: 'mono', text: m.from.address ? '<' + m.from.address + '>' : 'unknown' })),
        h('dt', { text: 'To' }), h('dd', { text: m.to.length ? m.to.join(', ') : '–' }),
        m.cc.length ? [h('dt', { text: 'Cc' }), h('dd', { text: m.cc.join(', ') })] : null,
        m.replyTo.length ? [h('dt', { text: 'Reply-To' }), h('dd', { text: m.replyTo.join(', ') })] : null,
        h('dt', { text: 'Received' }), h('dd', { text: when(m.receivedAt) }),
        m.headers && m.headers.date ? [h('dt', { text: 'Date header' }), h('dd', { text: m.headers.date })] : null,
        h('dt', { text: 'Checks' }), authRow,
        m.headers && m.headers['x-mailer'] ? [h('dt', { text: 'Mailer' }), h('dd', { text: m.headers['x-mailer'] })] : null,
        m.messageId ? [h('dt', { text: 'Message-ID' }), h('dd', { class: 'mono', text: m.messageId })] : null,
        h('dt', { text: 'Resend ID' }), h('dd', { class: 'mono', text: m.id }));
      var refetch = h('button', { class: 'btn ghost sm', onclick: function () {
        refetch.disabled = true;
        api('POST', '/inbox/' + encodeURIComponent(id) + '/refetch').then(function (r) {
          toast(r.result === 'FETCHED' ? 'Content loaded' : 'Still not available: ' + (r.fetchError || 'unknown error'), r.result !== 'FETCHED');
          reopen();
        }).catch(function (e) { refetch.disabled = false; toast(e.message || 'Error', true); });
      } }, m.contentStatus === 'FETCHED' ? 'Load content again' : 'Try again now');

      // Antwort
      var replyBox;
      if (d.canReply) {
        var lang = h('select', { 'aria-label': 'Language of the e-mail' }, [['en', 'English e-mail'], ['de', 'German e-mail']].map(function (l) {
          var o = h('option', { value: l[0] }, l[1]); if (d.replyLang === l[0]) o.selected = true; return o;
        }));
        var text = h('textarea', { rows: 7, maxlength: 5000, placeholder: 'Your reply. It is sent as a Catch e-mail with a greeting, signed "The Catch team", with the original message quoted below.' });
        var count = h('span', { class: 'counter', text: '0 / 5000' });
        text.addEventListener('input', function () { count.textContent = text.value.length + ' / 5000'; });
        var send = h('button', { class: 'btn primary sm', onclick: function () {
          if (!text.value.trim()) { text.focus(); return; }
          send.disabled = true;
          act(api('POST', '/inbox/' + encodeURIComponent(id) + '/reply', { message: text.value, lang: lang.value }), 'Reply sent to ' + m.from.address, reopen)
            .then(function () { send.disabled = false; });
        } }, 'Send reply');
        replyBox = h('div', { class: 'panel' },
          h('div', { class: 'panel-title', text: 'Reply to ' + m.from.address }),
          h('p', { class: 'hint', text: 'Subject: ' + reSubject(m.subject) + ' · from ' + d.replyFrom + (d.replyTo ? ' · replies go to ' + d.replyTo : '') + ' · stays in the same thread' }),
          m.authWarnings.length ? h('p', { class: 'hint warn-text', text: '⚠ ' + m.authWarnings.map(function (k) { return k.toUpperCase(); }).join(' / ') + ' failed: the real sender may be someone else. Your reply goes to the address shown above.' }) : null,
          h('label', null, 'Language', lang),
          h('label', null, 'Message', text), count,
          h('div', { class: 'actions' }, send));
      } else {
        replyBox = h('div', { class: 'note', text: d.replyBlocked === 'mail_not_configured' ? 'Replying is not possible: sending e-mails is not set up (RESEND_API_KEY).' : 'Replying is not possible: this e-mail has no valid sender address.' });
      }

      append(body, [
        h('div', { class: 'head mail-head' }, h('h2', { class: 'mail-subject', text: m.subject || '(no subject)' }), mailStatusPill(m.status), authPill(m),
          m.autoReply ? h('span', { class: 'pill hidden-pill' }, 'auto-reply') : null, contentPill(m)),
        kv,
        m.authWarnings.length ? h('div', { class: 'note warn', text: 'A sender check failed (' + m.authWarnings.map(function (k) { return k.toUpperCase(); }).join(', ') + '). The e-mail may not really come from ' + (m.from.address || 'this address') + '. Don’t trust links or requests in it.' }) : null,
        m.contentStatus !== 'FETCHED'
          ? h('div', { class: 'note' }, m.contentStatus === 'FETCH_FAILED'
              ? 'The content could not be loaded from Resend yet (' + (m.fetchError || 'unknown error') + '). It is retried automatically for a while (' + m.fetchAttempts + ' attempt' + (m.fetchAttempts === 1 ? '' : 's') + ' so far).'
              : 'The content is being loaded from Resend…', h('div', { class: 'actions' }, refetch))
          : null,
        h('h2', { class: 'section', text: 'Message' }),
        m.textFromHtml ? h('p', { class: 'hint', text: 'This e-mail only had an HTML version – it was converted to plain text. HTML is never shown here.' }) : null,
        h('div', { class: 'mailtext', text: m.text || (m.contentStatus === 'FETCHED' ? '(empty message)' : '(not loaded yet)') }),
        m.textTruncated ? h('p', { class: 'hint', text: 'The text was cut off after about 100 KB. The full e-mail is in the Resend dashboard.' }) : null,
        m.attachments.length ? [
          h('h2', { class: 'section', text: 'Attachments (' + m.attachments.length + ')' }),
          h('ul', { class: 'attach' }, m.attachments.map(function (a) {
            return h('li', null, h('span', { class: 'attach-name', text: '📎 ' + (a.filename || 'unnamed') + (a.inline ? ' (inline)' : '') }),
              h('span', { class: 'muted', text: (a.contentType || 'unknown type') + ' · ' + fmtSize(a.size) }));
          })),
          h('p', { class: 'hint', text: 'Catch never downloads or stores attachments. To open one, open this e-mail in the Resend dashboard (Emails → Receiving) and download it there.' }),
        ] : null,
        h('h2', { class: 'section', text: 'Catch account' }),
        m.user
          ? h('div', { class: 'card' },
              h('div', { class: 'head' }, h('span', { class: 'title', text: m.user.name || 'no name' }),
                m.user.banned ? h('span', { class: 'pill banned' }, 'banned') : null,
                m.user.restrictedUntil ? h('span', { class: 'pill restricted' }, 'reporting limited') : null),
              h('div', { class: 'meta' }, (m.user.email || '') + ' · ' + shortId(m.user.uid) + ' · language ' + (m.user.lang || '–') + ' · since ' + when(m.user.createdAt)),
              h('div', { class: 'actions' }, h('button', { class: 'btn ghost sm', onclick: function () { openUser(m.user.uid, null, reopen); } }, 'Open account')))
          : h('p', { class: 'muted', text: 'No Catch account uses this sender address.' }),
        m.user ? [
          h('h2', { class: 'section', text: 'Their recent moderation decisions (' + d.decisions.length + ')' }),
          decisionList(d.decisions),
          h('h2', { class: 'section', text: 'Their recent feedback (' + d.feedback.length + ')' }),
          d.feedback.length ? h('div', { class: 'list' }, d.feedback.map(function (f) {
            return h('div', { class: 'card decision' },
              h('div', { class: 'head' }, h('span', { class: 'pill' }, CAT_LABEL[f.category] || f.category), h('span', { class: 'meta', text: when(f.createdAt) + ' · ' + String(f.status).toLowerCase() })),
              h('div', { class: 'msg', text: f.message }));
          })) : h('p', { class: 'empty', text: 'No feedback.' }),
        ] : null,
        m.others.length ? [
          h('h2', { class: 'section', text: 'Other e-mails from this sender (' + m.others.length + ')' }),
          h('div', { class: 'list' }, m.others.map(function (o) {
            return h('div', { class: 'card decision' }, h('div', { class: 'head' },
              h('button', { class: 'link', onclick: function () { openMail(o.id, onChange); } }, o.subject || '(no subject)'), mailStatusPill(o.status)),
              h('div', { class: 'meta', text: when(o.receivedAt) }));
          })),
        ] : null,
        h('h2', { class: 'section', text: 'Replies (' + m.replies.length + ')' }),
        m.replies.length ? m.replies.map(function (rp) {
          var ok = rp.mailStatus === 'SENT';
          return h('div', { class: 'reply' + (ok ? '' : ' failed') },
            h('div', { class: 'reply-head', text: (ok ? 'Your reply' : 'Not sent (e-mail failed)') + ' · ' + when(rp.at) + (rp.lang ? ' · ' + (rp.lang === 'de' ? 'German' : 'English') : '') }),
            h('div', { class: 'msg', text: rp.message }));
        }) : h('p', { class: 'muted', text: 'Not answered yet.' }),
        replyBox,
        h('div', { class: 'actions' },
          m.status !== 'DONE' ? h('button', { class: 'btn ok sm', onclick: function () { setStatus('DONE', 'Marked as done'); } }, 'Mark done') : null,
          m.status === 'DONE' || m.status === 'SPAM' ? h('button', { class: 'btn ghost sm', onclick: function () { setStatus('READ', 'Reopened'); } }, m.status === 'SPAM' ? 'Not spam' : 'Reopen') : null,
          m.status !== 'NEW' && m.status !== 'SPAM' ? h('button', { class: 'btn ghost sm', onclick: function () { setStatus('NEW', 'Marked as new'); } }, 'Mark as new') : null,
          m.status !== 'SPAM' ? h('button', { class: 'btn warn sm', onclick: function () { setStatus('SPAM', 'Marked as spam'); } }, 'Spam') : null,
          h('button', { class: 'btn danger sm', onclick: function () {
            if (confirm('Delete this e-mail and your replies to it from Catch? (It stays in Resend.)')) {
              act(api('DELETE', '/inbox/' + encodeURIComponent(id)), 'Deleted', function () { closeSheet(); if (onChange) onChange(); });
            }
          } }, 'Delete')),
        h('div', { class: 'more' }, h('button', { class: 'btn ghost', onclick: closeSheet }, 'Close')),
      ]);
    }).catch(function (e) { clear(body); body.append(h('p', { class: 'error', text: e.message }), h('button', { class: 'btn ghost', onclick: closeSheet }, 'Close')); });
  }

  function refreshBadges() {
    api('GET', '/overview').then(function (o) {
      setBadge('badge-flagged', o.reports.flagged); setBadge('badge-feedback', o.feedback.new); setBadge('badge-inbox', o.inbox.new);
    }).catch(function () {});
  }

  // Protokoll
  var auditState = { view: 'log' };
  function renderAudit(c) {
    var seg = h('div', { class: 'seg' }, [['log', 'Admin log'], ['decisions', 'Moderation decisions']].map(function (v) {
      return h('button', { class: auditState.view === v[0] ? 'active' : '', onclick: function () { auditState.view = v[0]; selectTab('audit'); } }, v[1]);
    }));
    c.append(h('div', { class: 'filters' }, seg));
    var box = h('div', null, h('p', { class: 'muted', text: 'Loading…' }));
    c.append(box);
    if (auditState.view === 'decisions') {
      api('GET', '/decisions?limit=150').then(function (d) {
        clear(box);
        box.append(h('p', { class: 'muted', text: 'Every restriction of content or accounts with its reason – by admin or automated (flags, disputes, reporting limit). The affected person is told by e-mail. Kept for 1 year.' }));
        if (!d.items.length) { box.append(h('p', { class: 'empty', text: 'No decisions yet.' })); return; }
        box.append(h('div', { class: 'scroll-x' }, h('table', { class: 'audit' },
          h('thead', null, h('tr', null, h('th', { text: 'When' }), h('th', { text: 'Decision' }), h('th', { text: 'Reason' }), h('th', { text: 'By' }), h('th', { text: 'Account' }), h('th', { text: 'Report' }), h('th', { text: 'E-mail' }))),
          h('tbody', null, d.items.map(function (x) {
            return h('tr', { class: x.mailStatus === 'FAILED' ? 'bad' : '' },
              h('td', { text: fmt.format(new Date(x.createdAt)) }),
              h('td', { text: DECISION_LABEL[x.action] || x.action }),
              h('td', null, REASON_LABEL[x.reason] || x.reason, x.note ? h('div', { class: 'muted', text: '“' + x.note + '”' }) : null),
              h('td', { text: x.automated ? 'automated' : 'admin' }),
              h('td', null, x.userId ? h('button', { class: 'link mono', onclick: function () { openUser(x.userId); } }, shortId(x.userId)) : '–'),
              h('td', { class: 'mono', text: x.reportId ? '#' + x.reportId : '–' }),
              h('td', { text: MAIL_LABEL[x.mailStatus] || x.mailStatus }));
          })))));
      }).catch(function (e) { clear(box); box.append(h('p', { class: 'error', text: e.message })); });
      return;
    }
    c = box;
    api('GET', '/audit?limit=150').then(function (d) {
      clear(c);
      c.append(h('p', { class: 'muted', text: 'All admin actions and sign-in attempts (kept for 180 days). Times in Berlin time.' }));
      if (!d.items.length) { c.append(h('p', { class: 'empty', text: 'Nothing logged yet.' })); return; }
      c.append(h('div', { class: 'scroll-x' }, h('table', { class: 'audit' },
        h('thead', null, h('tr', null, h('th', { text: 'When' }), h('th', { text: 'What' }), h('th', { text: 'Target' }), h('th', { text: 'Account' }), h('th', { text: 'IP' }))),
        h('tbody', null, d.items.map(function (a) {
          var bad = /fail|locked|denied/.test(a.action) || (a.detail && a.detail.mail === 'FAILED');
          return h('tr', { class: bad ? 'bad' : '' },
            h('td', { text: fmt.format(new Date(a.at)) }),
            h('td', { text: (ACTION_LABEL[a.action] || a.action) + (a.detail && a.detail.status ? ' → ' + a.detail.status : '') + (a.detail && a.detail.hideReports ? ' (+ reports hidden)' : '') + (a.detail && a.detail.deleteReports ? ' (+ reports deleted)' : '') +
              (a.detail && a.detail.reason ? ' · ' + (REASON_LABEL[a.detail.reason] || a.detail.reason) : '') + (a.detail && a.detail.mail ? ' · ' + (MAIL_LABEL[a.detail.mail] || a.detail.mail) : '') +
              (a.detail && a.detail.error ? ' · ' + a.detail.error : '') }),
            h('td', { class: 'mono', text: a.target || '–' }),
            h('td', { class: 'mono', text: shortId(a.uid) }),
            h('td', { class: 'mono', text: a.ip || '–' }));
        })))));
    }).catch(function (e) { clear(c); c.append(h('p', { class: 'error', text: e.message })); });
  }


  showLogin();
})();
