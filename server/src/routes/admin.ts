// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Admin-API unter /v1/admin – nur für die Firebase-UIDs in ADMIN_UIDS und nur mit zweitem Faktor.
 * Für alle anderen sieht es so aus, als gäbe es diese Adressen nicht (404).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { bearer, type TokenVerifier } from '../auth/auth.js';
import type { Deps } from '../deps.js';
import { HttpError, parse } from '../http.js';
import { REPORT_KINDS } from '../contract.js';
import {
  adminConfigured,
  AdminSessions,
  createAdminTokenVerifier,
  ipAllowed,
  LoginThrottle,
  parseList,
  type AdminIdentity,
  type AdminTokenVerifier,
} from '../admin/guard.js';
import * as svc from '../admin/service.js';
import { verifyTotp } from '../admin/totp.js';
import { parseLang } from '../i18n.js';
import { BAN_REASONS, feedbackReplyMail, inboxReplyMail, objectionRoute, REPORT_REASONS } from '../mail/moderation.js';
import { detectLang, isEmailAddress, threadHeaders } from '../mail/inbound.js';
import * as inbox from '../services/inbox.js';
import { cleanText } from './account.js';
import {
  canMail,
  checkThrottle,
  deleteOldDecisions,
  inBackground,
  liftThrottle,
  listDecisions,
  mailSender,
  recordDecision,
  reportInfo,
} from '../services/moderation.js';
import { getTrust } from '../services/trust.js';

declare module 'fastify' {
  interface FastifyRequest {
    admin: AdminIdentity | null;
  }
}

export interface AdminRouteOptions {
  verify?: AdminTokenVerifier;
  now?: () => number;
}

const reportId = z.object({ id: z.string().regex(/^\d{1,18}$/) });
const userId = z.object({ uid: z.string().regex(/^[\w-]{1,128}$/) });
const page = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
};
/** Kurze Notiz des Admins zur Entscheidung (steht in der Mail an die betroffene Person). */
const decisionNote = z.string().max(400).transform(cleanText).pipe(z.string().max(300)).optional();
const hideBody = z.object({ reason: z.enum(REPORT_REASONS).default('OTHER'), note: decisionNote });
const banBody = z.object({ hideReports: z.boolean().default(false), reason: z.enum(BAN_REASONS).default('OTHER'), note: decisionNote });
/** Antwort auf Feedback: 1–3000 Zeichen */
export const FEEDBACK_REPLY_MAX = 3000;
export const replyBody = z.object({
  message: z.string().max(FEEDBACK_REPLY_MAX + 500).transform(cleanText).pipe(z.string().min(1).max(FEEDBACK_REPLY_MAX)),
});
/** Antwort auf eine empfangene Mail: 1–5000 Zeichen, Sprache optional (sonst Konto bzw. erkannt) */
export const INBOX_REPLY_MAX = 5000;
export const inboxReplyBody = z.object({
  message: z.string().max(INBOX_REPLY_MAX + 500).transform(cleanText).pipe(z.string().min(1).max(INBOX_REPLY_MAX)),
  lang: z.enum(['en', 'de']).optional(),
});
const inboxId = z.object({ id: z.string().regex(/^[\w.-]{1,128}$/) });

export async function adminRoutes(app: FastifyInstance, deps: Deps, baseVerify: TokenVerifier, opts: AdminRouteOptions = {}) {
  const { cfg, db, log } = deps;
  const admins = new Set(parseList(cfg.ADMIN_UIDS));
  const allowIps = parseList(cfg.ADMIN_ALLOW_IPS);
  const verify = opts.verify ?? createAdminTokenVerifier(cfg, baseVerify);
  const now = opts.now ?? Date.now;
  const sessions = new AdminSessions(cfg.ADMIN_SESSION_MINUTES * 60_000, 8 * 3600_000, now);
  const throttle = new LoginThrottle(5, 15 * 60_000, 15 * 60_000, now);
  const deniedLogged = new Map<string, number>();
  const notFound = () => new HttpError(404, 'not_found', 'route_not_found');

  const ipOf = (req: FastifyRequest) => req.ip;
  const who = (req: FastifyRequest) => req.admin!;
  const record = (req: FastifyRequest, action: string, target?: string | null, detail?: Record<string, unknown> | null) =>
    svc.audit(db, { uid: req.admin?.uid ?? null, action, target, detail, ip: ipOf(req) }).catch((err) => log.warn({ err }, 'Admin-Protokoll'));

  if (!adminConfigured(cfg)) log.info('Admin-Bereich ist aus (ADMIN_UIDS / ADMIN_TOTP_SECRET fehlen – sudo catch-admin 2fa).');

  // Moderations-Entscheidungen nach 1 Jahr löschen (alle 6 Stunden prüfen)
  let decisionCleanup: NodeJS.Timeout | null = null;
  app.addHook('onReady', async () => {
    decisionCleanup = setInterval(() => deleteOldDecisions(db).catch((err) => log.warn({ err }, 'Entscheidungen aufräumen')), 6 * 3600_000);
    decisionCleanup.unref();
  });
  app.addHook('onClose', async () => {
    if (decisionCleanup) clearInterval(decisionCleanup);
  });

  await app.register(
    async (r) => {
      r.decorateRequest('admin', null);

      r.addHook('onSend', async (_req, reply, payload) => {
        reply.header('Cache-Control', 'no-store');
        reply.header('X-Robots-Tag', 'noindex, nofollow');
        return payload;
      });

      r.addHook('onRequest', async (req, reply) => {
        if (!adminConfigured(cfg)) throw notFound();
        if (!ipAllowed(ipOf(req), allowIps)) throw notFound();
        const token = bearer(req);
        if (!token) throw notFound();
        let id: AdminIdentity;
        try {
          id = await verify(token);
        } catch {
          throw new HttpError(401, 'unauthorized', 'session_expired');
        }
        if (!admins.has(id.uid)) {
          // Angemeldeter Nutzer ohne Admin-Rechte: protokollieren (höchstens 1× pro Stunde je Konto)
          const last = deniedLogged.get(id.uid) ?? 0;
          if (now() - last > 3600_000) {
            deniedLogged.set(id.uid, now());
            if (deniedLogged.size > 1000) deniedLogged.clear();
            svc.audit(db, { uid: id.uid, action: 'denied', target: req.url.slice(0, 120), ip: ipOf(req) }).catch(() => undefined);
          }
          throw notFound();
        }
        req.admin = id;
        if (req.routeOptions.url === '/v1/admin/login') return;
        const raw = req.headers['x-admin-session'];
        const s = sessions.touch(typeof raw === 'string' ? raw : undefined, id.uid);
        if (!s) throw new HttpError(401, 'admin_2fa_required', 'admin_2fa_required');
        reply.header('X-Admin-Session-Expires', new Date(s.expiresAt).toISOString());
      });

      // --- Anmeldung mit zweitem Faktor ------------------------------------------------------
      r.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
        const { code } = parse(z.object({ code: z.string().trim().max(12) }), req.body);
        const locked = throttle.lockedFor();
        if (locked > 0) {
          void record(req, 'login_locked');
          throw new HttpError(429, 'admin_locked', 'admin_locked', { minutes: Math.ceil(locked / 60_000) });
        }
        const counter = verifyTotp(cfg.ADMIN_TOTP_SECRET, code, now());
        if (counter === null || !throttle.accept(who(req).uid, counter)) {
          throttle.fail();
          void record(req, 'login_fail');
          throw new HttpError(401, 'admin_2fa_invalid', 'admin_2fa_invalid');
        }
        const s = sessions.create(who(req).uid);
        void record(req, 'login_ok');
        return { session: s.token, expiresAt: new Date(s.expiresAt).toISOString(), uid: who(req).uid, email: who(req).email };
      });

      r.post('/logout', async (req, reply) => {
        const raw = req.headers['x-admin-session'];
        sessions.revoke(typeof raw === 'string' ? raw : undefined);
        void record(req, 'logout');
        return reply.code(204).send();
      });

      r.get('/me', async (req) => ({ uid: who(req).uid, email: who(req).email }));
      r.get('/overview', async () => {
        const o = await svc.overview(db);
        return { ...o, inbox: { ...o.inbox, enabled: inbox.inboundEnabled(cfg) } };
      });

      // --- Hinweise ------------------------------------------------------------------------------
      r.get('/reports', async (req) => {
        const q = parse(
          z.object({
            view: z.enum(['recent', 'flagged', 'hidden']).default('recent'),
            kind: z.enum(REPORT_KINDS as [string, ...string[]]).optional(),
            uid: z.string().regex(/^[\w-]{1,128}$/).optional(),
            q: z.string().trim().min(1).max(80).optional(),
            ...page,
          }),
          req.query,
        );
        return svc.listReports(db, q);
      });
      // Ausblenden/Löschen mit Grund → Entscheidung speichern + Begründungs-Mail an den Meldenden
      r.post('/reports/:id/hide', async (req) => {
        const { id } = parse(reportId, req.params);
        const body = parse(hideBody, req.body ?? {});
        const info = await reportInfo(db, id);
        const res = await svc.setReportHidden(db, id, true);
        if (!info || !res) throw new HttpError(404, 'not_found', 'report_not_found');
        if (res.wasHidden) return { decision: null };
        const decision = await recordDecision(deps, {
          userId: info.userId, reportId: id, report: info.info, action: 'REPORT_HIDE',
          reason: body.reason, note: body.note, automated: false, adminUid: who(req).uid,
        });
        void record(req, 'report_hide', id, { reason: body.reason, decision: decision.id, mail: decision.mailStatus });
        if (info.userId) inBackground(deps, 'throttle', checkThrottle(deps, info.userId));
        return { decision };
      });
      r.post('/reports/:id/unhide', async (req) => {
        const { id } = parse(reportId, req.params);
        const info = await reportInfo(db, id);
        const res = await svc.setReportHidden(db, id, false);
        if (!info || !res) throw new HttpError(404, 'not_found', 'report_not_found');
        const decision = res.wasHidden
          ? await recordDecision(deps, {
              userId: info.userId, reportId: id, report: info.info, action: 'REPORT_UNHIDE',
              reason: 'REVIEWED', automated: false, adminUid: who(req).uid,
            })
          : null;
        void record(req, res.wasHidden ? 'report_unhide' : 'report_flags_dismissed', id, decision ? { decision: decision.id } : null);
        return { decision };
      });
      r.delete('/reports/:id', async (req) => {
        const { id } = parse(reportId, req.params);
        // Grund optional als Query (?reason=SPAM&note=…), weil DELETE meist ohne Body kommt
        const body = parse(hideBody, { ...((req.body as object | undefined) ?? {}), ...(req.query as object) });
        const info = await reportInfo(db, id);
        if (!info || !(await svc.deleteReport(db, id))) throw new HttpError(404, 'not_found', 'report_not_found');
        const decision = await recordDecision(deps, {
          userId: info.userId, reportId: id, report: info.info, action: 'REPORT_DELETE',
          reason: body.reason, note: body.note, automated: false, adminUid: who(req).uid,
        });
        void record(req, 'report_delete', id, { reason: body.reason, decision: decision.id, mail: decision.mailStatus });
        if (info.userId) inBackground(deps, 'throttle', checkThrottle(deps, info.userId));
        return { decision };
      });

      // Moderations-Entscheidungen (alle oder eines Kontos)
      r.get('/decisions', async (req) => {
        const q = parse(z.object({ uid: z.string().regex(/^[\w-]{1,128}$/).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
        return { items: await listDecisions(db, q) };
      });

      // --- Konten -------------------------------------------------------------------------------
      const notAdmin = (uid: string) => {
        if (admins.has(uid)) throw new HttpError(400, 'admin_self', 'admin_self');
      };
      r.get('/users', async (req) => {
        const q = parse(
          z.object({ q: z.string().trim().min(1).max(120).optional(), filter: z.enum(['all', 'banned', 'flagged', 'restricted']).default('all'), ...page }),
          req.query,
        );
        return svc.listUsers(db, q);
      });
      r.get('/users/:uid', async (req) => {
        const { uid } = parse(userId, req.params);
        const user = await svc.getUser(db, uid);
        if (!user) throw new HttpError(404, 'not_found', 'user_not_found');
        const reports = await svc.listReports(db, { view: 'recent', uid, limit: 30, offset: 0 });
        const trust = await getTrust(db, uid);
        const decisions = await listDecisions(db, { uid, limit: 50 });
        return {
          user,
          reports: reports.items,
          isAdmin: admins.has(uid),
          trust: { score: trust.score, level: trust.level, negative: trust.negative, inputs: trust.inputs },
          decisions,
        };
      });
      r.post('/users/:uid/ban', async (req) => {
        const { uid } = parse(userId, req.params);
        const { hideReports, reason, note } = parse(banBody, req.body ?? {});
        notAdmin(uid);
        const before = await svc.getUser(db, uid);
        if (!before || !(await svc.setBanned(db, uid, true, hideReports))) throw new HttpError(404, 'not_found', 'user_not_found');
        if (before.banned) return { decision: null }; // schon gesperrt: keine zweite Entscheidung/Mail
        const decision = await recordDecision(deps, {
          userId: uid, action: 'USER_BAN', reason, note, detail: { hideReports }, automated: false, adminUid: who(req).uid,
        });
        void record(req, 'user_ban', uid, { hideReports, reason, decision: decision.id, mail: decision.mailStatus });
        return { decision };
      });
      r.post('/users/:uid/unban', async (req) => {
        const { uid } = parse(userId, req.params);
        const before = await svc.getUser(db, uid);
        if (!before || !(await svc.setBanned(db, uid, false))) throw new HttpError(404, 'not_found', 'user_not_found');
        if (!before.banned) return { decision: null };
        const decision = await recordDecision(deps, { userId: uid, action: 'USER_UNBAN', reason: 'REVIEWED', automated: false, adminUid: who(req).uid });
        void record(req, 'user_unban', uid, { decision: decision.id, mail: decision.mailStatus });
        return { decision };
      });
      // Automatische Drosselung aufheben
      r.post('/users/:uid/unrestrict', async (req) => {
        const { uid } = parse(userId, req.params);
        if (!(await svc.getUser(db, uid))) throw new HttpError(404, 'not_found', 'user_not_found');
        if (!(await liftThrottle(db, uid))) return { decision: null };
        const decision = await recordDecision(deps, { userId: uid, action: 'USER_UNTHROTTLE', reason: 'REVIEWED', automated: false, adminUid: who(req).uid });
        void record(req, 'user_unrestrict', uid, { decision: decision.id, mail: decision.mailStatus });
        return { decision };
      });
      r.post('/users/:uid/reset-name', async (req, reply) => {
        const { uid } = parse(userId, req.params);
        if (!(await svc.resetName(db, uid))) throw new HttpError(404, 'not_found', 'user_not_found');
        void record(req, 'user_reset_name', uid);
        return reply.code(204).send();
      });
      r.delete('/users/:uid', async (req, reply) => {
        const { uid } = parse(userId, req.params);
        const { deleteReports } = parse(z.object({ deleteReports: z.enum(['true', 'false']).default('false') }), req.query);
        notAdmin(uid);
        if (!(await svc.deleteUserData(db, uid, deleteReports === 'true'))) throw new HttpError(404, 'not_found', 'user_not_found');
        void record(req, 'user_delete', uid, { deleteReports: deleteReports === 'true' });
        return reply.code(204).send();
      });

      // --- Feedback -----------------------------------------------------------------------------
      const status = z.enum(['NEW', 'READ', 'DONE']);
      r.get('/feedback', async (req) => {
        const q = parse(z.object({ status: status.optional(), ...page }), req.query);
        return svc.listFeedback(db, q);
      });
      r.patch('/feedback/:id', async (req, reply) => {
        const { id } = parse(reportId, req.params);
        const body = parse(z.object({ status }), req.body);
        if (!(await svc.setFeedbackStatus(db, id, body.status))) throw new HttpError(404, 'not_found', 'feedback_not_found');
        void record(req, 'feedback_status', id, { status: body.status });
        return reply.code(204).send();
      });
      // Antwort per Mail (nur, wenn die Person zugestimmt hat) → gespeichert, Status "erledigt"
      r.post('/feedback/:id/reply', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
        const { id } = parse(reportId, req.params);
        const { message } = parse(replyBody, req.body);
        const fb = await svc.getFeedbackForReply(db, id);
        if (!fb) throw new HttpError(404, 'not_found', 'feedback_not_found');
        if (!fb.email) throw new HttpError(400, 'no_contact', 'feedback_no_contact');
        if (!canMail(deps)) throw new HttpError(503, 'mail_not_configured', 'mail_not_configured');
        const lang = parseLang(fb.lang) ?? 'en';
        const mail = feedbackReplyMail(lang, { reply: message, original: fb.message, sentAt: fb.createdAt }, cfg.CATCH_PUBLIC_URL, objectionRoute(cfg));
        try {
          await mailSender(deps)({ to: fb.email, ...mail });
        } catch (err) {
          const error = (err as Error).message?.slice(0, 200) ?? 'unknown';
          log.error({ err: error }, 'Antwort auf Feedback konnte nicht gesendet werden');
          void record(req, 'mail_failed', id, { kind: 'feedback_reply', error });
          throw new HttpError(502, 'mail_failed', 'mail_failed');
        }
        const saved = await svc.addFeedbackReply(db, id, who(req).uid, message);
        void record(req, 'feedback_reply', id, { length: message.length });
        return { reply: saved };
      });
      r.delete('/feedback/:id', async (req, reply) => {
        const { id } = parse(reportId, req.params);
        if (!(await svc.deleteFeedback(db, id))) throw new HttpError(404, 'not_found', 'feedback_not_found');
        void record(req, 'feedback_delete', id);
        return reply.code(204).send();
      });

      // --- Postfach (empfangene E-Mails über Resend) --------------------------------------------
      const inboxStatus = z.enum(inbox.INBOX_STATUSES);
      /** Sprache der Antwort: Sprache des Kontos, sonst aus Betreff/Text erraten. */
      const replyLangFor = (m: { userLang: string | null; subject: string | null; text: string | null }) =>
        parseLang(m.userLang) ?? detectLang(m.subject, m.text);
      r.get('/inbox', async (req) => {
        const q = parse(
          z.object({
            status: z.enum([...inbox.INBOX_STATUSES, 'ALL', '']).optional(),
            q: z.string().trim().max(120).optional(),
            ...page,
          }),
          req.query,
        );
        const status = q.status && q.status !== 'ALL' ? q.status : undefined;
        const res = await inbox.listInbox(db, { status, q: q.q || undefined, limit: q.limit, offset: q.offset });
        return { ...res, enabled: inbox.inboundEnabled(cfg) };
      });
      r.get('/inbox/:id', async (req) => {
        const { id } = parse(inboxId, req.params);
        const mail = await inbox.getInboxMail(db, id);
        if (!mail) throw new HttpError(404, 'not_found', 'inbox_not_found');
        const uid = mail.user?.uid;
        const [decisions, feedback] = uid ? await Promise.all([listDecisions(db, { uid, limit: 10 }), inbox.recentFeedback(db, uid)]) : [[], []];
        const address = mail.from.address?.trim() ?? '';
        return {
          mail,
          decisions,
          feedback,
          replyLang: replyLangFor({ userLang: mail.user?.lang ?? null, subject: mail.subject, text: mail.text }),
          canReply: isEmailAddress(address) && canMail(deps),
          replyBlocked: !isEmailAddress(address) ? 'no_address' : !canMail(deps) ? 'mail_not_configured' : null,
          replyFrom: cfg.MAIL_FROM,
          replyTo: cfg.MAIL_REPLY_TO || null,
        };
      });
      r.patch('/inbox/:id', async (req, reply) => {
        const { id } = parse(inboxId, req.params);
        const body = parse(z.object({ status: inboxStatus }), req.body);
        if (!(await inbox.setInboxStatus(db, id, body.status))) throw new HttpError(404, 'not_found', 'inbox_not_found');
        void record(req, 'inbox_status', id, { status: body.status });
        return reply.code(204).send();
      });
      r.delete('/inbox/:id', async (req, reply) => {
        const { id } = parse(inboxId, req.params);
        if (!(await inbox.deleteInboxMail(db, id))) throw new HttpError(404, 'not_found', 'inbox_not_found');
        void record(req, 'inbox_delete', id);
        return reply.code(204).send();
      });
      // Inhalt erneut bei Resend abrufen (z. B. nach FETCH_FAILED)
      r.post('/inbox/:id/refetch', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => {
        const { id } = parse(inboxId, req.params);
        const result = await inbox.loadInboundContent(deps, id, { force: true });
        if (!result) throw new HttpError(404, 'not_found', 'inbox_not_found');
        void record(req, 'inbox_refetch', id, { result });
        const mail = await inbox.getInboxMail(db, id);
        return { result, contentStatus: mail?.contentStatus ?? null, fetchError: mail?.fetchError ?? null };
      });
      // Antwort per Mail an den Absender: Catch-Layout, "Re: …", In-Reply-To/References → gespeichert, "erledigt"
      r.post('/inbox/:id/reply', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
        const { id } = parse(inboxId, req.params);
        const { message, lang: chosen } = parse(inboxReplyBody, req.body);
        const m = await inbox.inboxForReply(db, id);
        if (!m) throw new HttpError(404, 'not_found', 'inbox_not_found');
        const to = m.fromAddress?.trim() ?? '';
        if (!isEmailAddress(to)) throw new HttpError(400, 'no_address', 'inbox_no_address');
        if (!canMail(deps)) throw new HttpError(503, 'mail_not_configured', 'mail_not_configured');
        const lang = chosen ?? replyLangFor(m);
        const content = inboxReplyMail(
          lang,
          { reply: message, original: m.text, receivedAt: m.receivedAt, subject: m.subject, name: m.fromName },
          cfg.CATCH_PUBLIC_URL,
          objectionRoute(cfg),
        );
        const headers = threadHeaders(m.messageId, m.references, m.inReplyTo);
        let resendId: string | null = null;
        try {
          const sent = await mailSender(deps)({ to, ...content, headers });
          resendId = sent?.id ?? null;
        } catch (err) {
          const error = (err as Error).message?.slice(0, 200) ?? 'unknown';
          log.error({ err: error, email: id }, 'Antwort auf E-Mail konnte nicht gesendet werden');
          await inbox.addInboxReply(db, { inboundId: id, adminUid: who(req).uid, message, lang, mailStatus: 'FAILED' }).catch(() => undefined);
          void record(req, 'mail_failed', id, { kind: 'inbox_reply', error });
          throw new HttpError(502, 'mail_failed', 'mail_failed');
        }
        const saved = await inbox.addInboxReply(db, { inboundId: id, adminUid: who(req).uid, message, lang, mailStatus: 'SENT', resendId });
        void record(req, 'inbox_reply', id, { length: message.length, lang });
        return { reply: saved, subject: content.subject };
      });

      // --- Protokoll ----------------------------------------------------------------------------
      r.get('/audit', async (req) => {
        const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
        return { items: await svc.listAudit(db, limit) };
      });
    },
    { prefix: '/v1/admin' },
  );
}
