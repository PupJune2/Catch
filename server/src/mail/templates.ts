// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * E-Mail-Vorlagen im Catch-Design (dunkles Navy, Lime-Button, Geist-Logo).
 * Tabellen-Layout + Inline-Styles, damit es in Gmail, Outlook, Apple Mail & Co. gleich aussieht.
 */
import type { Lang } from '../i18n.js';
import type { MailMessage } from './resend.js';

export const MAIL_COLORS = {
  page: '#111A30',
  card: '#22304F',
  text: '#FFFFFF',
  body: '#C3CBE0',
  muted: '#8C97B2',
  lime: '#C7E8A5',
  onLime: '#14203A',
  line: '#2B3B60',
};
const C = MAIL_COLORS;
export const MAIL_FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT = MAIL_FONT;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface Layout {
  lang: Lang;
  publicUrl: string;
  preheader: string;
  title: string;
  /** Absätze als HTML – Inhalte von Nutzern vorher mit escapeHtml() maskieren! */
  paragraphs: string[];
  /** Optional: Kasten mit Angaben [Bezeichnung, Wert] (reiner Text, wird hier maskiert). */
  details?: Array<[string, string]>;
  /** Optional: zitierte Texte (reiner Text, wird hier maskiert; Zeilenumbrüche bleiben). */
  quotes?: Array<{ label: string; text: string; highlight?: boolean }>;
  /** Optional: Absätze (HTML) nach Kasten/Zitaten. */
  after?: string[];
  button?: { label: string; url: string };
  fallback?: string;
  note: string;
  footer: string;
}

/** Reiner Text → HTML mit Zeilenumbrüchen. */
export function textToHtml(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, '<br>');
}

function detailsBox(rows: Array<[string, string]>): string {
  const tr = rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:${i === 0 ? 0 : 10}px 0 0;font-family:${FONT};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${C.muted};">${escapeHtml(k)}</td></tr>
        <tr><td style="padding:2px 0 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${C.text};">${textToHtml(v)}</td></tr>`,
    )
    .join('\n        ');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr>
        <td bgcolor="${C.page}" style="background:${C.page};border-radius:16px;padding:16px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${tr}
        </table>
        </td></tr></table>`;
}

function quoteBox(q: { label: string; text: string; highlight?: boolean }): string {
  const bar = q.highlight ? C.lime : C.line;
  const color = q.highlight ? C.text : C.body;
  return `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${C.muted};">${escapeHtml(q.label)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
        <td width="4" bgcolor="${bar}" style="background:${bar};border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>
        <td bgcolor="${C.page}" style="background:${C.page};border-radius:0 14px 14px 0;padding:14px 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${color};word-break:break-word;">${textToHtml(q.text)}</td>
      </tr></table>`;
}

export function layout(o: Layout): string {
  const base = o.publicUrl.replace(/\/+$/, '');
  const url = o.button ? escapeHtml(o.button.url) : '';
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.body};">${t}</p>`;
  const extra = [
    o.details?.length ? detailsBox(o.details) : '',
    ...(o.quotes ?? []).map(quoteBox),
    ...(o.after ?? []).map(p),
  ].filter(Boolean);
  const button = o.button
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 24px;"><tr>
        <td bgcolor="${C.lime}" style="background:${C.lime};border-radius:999px;">
          <a href="${url}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:${C.onLime};text-decoration:none;border-radius:999px;">${escapeHtml(o.button.label)}</a>
        </td>
      </tr></table>${
        o.fallback
          ? `
      <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">${escapeHtml(o.fallback)}</p>
      <p style="margin:0 0 24px;font-family:${FONT};font-size:13px;line-height:1.5;word-break:break-all;"><a href="${url}" style="color:${C.lime};text-decoration:underline;">${url}</a></p>`
          : ''
      }`
    : '';
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${escapeHtml(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding:0 8px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;"><img src="${escapeHtml(base)}/assets/img/icon-180.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:12px;"></td>
        <td style="vertical-align:middle;padding-left:12px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${C.text};">Catch</td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${C.card}" style="background:${C.card};border-radius:24px;padding:36px 32px;">
      <h1 style="margin:0 0 18px;font-family:${FONT};font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:${C.text};">${escapeHtml(o.title)}</h1>
      ${[...o.paragraphs.map(p), ...extra].join('\n      ')}${button}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${o.button ? '' : ' style="margin-top:8px;"'}><tr><td style="border-top:1px solid ${C.line};padding-top:18px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.muted};">${escapeHtml(o.note)}</td></tr></table>
    </td></tr>
    <tr><td style="padding:22px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">
      ${escapeHtml(o.footer)}<br>
      <a href="${escapeHtml(base)}" style="color:${C.muted};text-decoration:underline;">${escapeHtml(base.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const RESET_TEXT: Record<Lang, {
  subject: string;
  preheader: string;
  title: string;
  hello: (email: string) => string;
  body: string;
  button: string;
  fallback: string;
  note: string;
  footer: string;
  /** Fußzeile, wenn Antworten ankommen (MAIL_REPLY_TO gesetzt). */
  footerReplyable: string;
}> = {
  en: {
    subject: 'Reset your Catch password',
    preheader: 'Choose a new password for your Catch account – the link is valid for 1 hour.',
    title: 'Reset your password',
    hello: (e) => `Someone (hopefully you) asked to reset the password for the Catch account <strong style="color:#FFFFFF;">${escapeHtml(e)}</strong>.`,
    body: 'Tap the button to choose a new password. The link is valid for 1 hour and can only be used once.',
    button: 'Choose new password',
    fallback: 'Button not working? Copy this link into your browser:',
    note: 'Didn’t ask for this? Just ignore this e-mail – your password stays the same and nobody can change it without this link.',
    footer: 'Catch – live tips from passengers on buses and trains. This is an automatic e-mail, replies are not read.',
    footerReplyable: 'Catch – live tips from passengers on buses and trains. This is an automatic e-mail.',
  },
  de: {
    subject: 'Dein Catch-Passwort zurücksetzen',
    preheader: 'Wähle ein neues Passwort für dein Catch-Konto – der Link gilt 1 Stunde.',
    title: 'Passwort zurücksetzen',
    hello: (e) => `Jemand (hoffentlich du) möchte das Passwort für das Catch-Konto <strong style="color:#FFFFFF;">${escapeHtml(e)}</strong> zurücksetzen.`,
    body: 'Tippe auf den Button, um ein neues Passwort zu wählen. Der Link gilt 1 Stunde und funktioniert nur einmal.',
    button: 'Neues Passwort wählen',
    fallback: 'Button funktioniert nicht? Kopiere diesen Link in deinen Browser:',
    note: 'Das warst nicht du? Dann ignoriere diese E-Mail einfach – dein Passwort bleibt, wie es ist, und ohne diesen Link kann es niemand ändern.',
    footer: 'Catch – Live-Hinweise von Fahrgästen für Bus und Bahn. Dies ist eine automatische E-Mail, Antworten werden nicht gelesen.',
    footerReplyable: 'Catch – Live-Hinweise von Fahrgästen für Bus und Bahn. Dies ist eine automatische E-Mail.',
  },
};

export function passwordResetMail(
  lang: Lang,
  email: string,
  resetUrl: string,
  publicUrl: string,
  replyable = false,
): Omit<MailMessage, 'to'> {
  const t = RESET_TEXT[lang];
  const footer = replyable ? t.footerReplyable : t.footer;
  const html = layout({
    lang,
    publicUrl,
    preheader: t.preheader,
    title: t.title,
    paragraphs: [t.hello(email), escapeHtml(t.body)],
    button: { label: t.button, url: resetUrl },
    fallback: t.fallback,
    note: t.note,
    footer,
  });
  const text = [
    t.title,
    '',
    t.hello(email).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
    t.body,
    '',
    `${t.button}: ${resetUrl}`,
    '',
    t.note,
    '',
    '— ' + footer,
    publicUrl,
  ].join('\n');
  return { subject: t.subject, html, text };
}
