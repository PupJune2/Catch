-- Moderation mit Begründung (DSA Art. 17), Vertrauens-System, Antworten auf Feedback

-- Entscheidungen über Inhalte und Konten: Grundlage der Begründungs-Mails, sichtbar im
-- Admin-Bereich. Wird nach 1 Jahr gelöscht.
CREATE TABLE moderation_decisions (
  id           bigserial PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  user_id      text REFERENCES users(id) ON DELETE SET NULL,   -- betroffenes Konto
  report_id    bigint,                                         -- ohne FK: die Meldung kann gelöscht sein
  report_info  jsonb,                                          -- Art, Linie, Halte, Zeit zum Entscheidungszeitpunkt
  action       text NOT NULL CHECK (action IN (
                 'REPORT_HIDE', 'REPORT_DELETE', 'REPORT_UNHIDE',
                 'USER_BAN', 'USER_UNBAN', 'USER_THROTTLE', 'USER_UNTHROTTLE')),
  reason       text NOT NULL CHECK (reason IN (
                 'WRONG', 'SPAM', 'PERSONAL_DATA', 'INAPPROPRIATE', 'OTHER',
                 'REPEATED_FALSE_REPORTS', 'ABUSE', 'FLAGGED', 'DISPUTED', 'REVIEWED')),
  note         text CHECK (char_length(note) <= 300),
  detail       jsonb,                                          -- z. B. {"hideReports": true} oder {"until": "…"}
  automated    boolean NOT NULL DEFAULT false,
  admin_uid    text,
  mail_status  text NOT NULL DEFAULT 'PENDING' CHECK (mail_status IN (
                 'PENDING', 'SENT', 'NO_EMAIL', 'NOT_CONFIGURED', 'RATE_LIMITED', 'FAILED', 'NOT_NEEDED'))
);
CREATE INDEX moderation_decisions_user_idx ON moderation_decisions (user_id, created_at DESC);
CREATE INDEX moderation_decisions_at_idx ON moderation_decisions (created_at DESC);
CREATE INDEX moderation_decisions_report_idx ON moderation_decisions (report_id);

-- Vertrauensstufe des Meldenden zum Zeitpunkt der Meldung (nur die Stufe, keine Identität)
-- und ob Live-Alarme bis zur ersten Bestätigung zurückgehalten werden.
ALTER TABLE reports ADD COLUMN reporter_trust smallint NOT NULL DEFAULT 1 CHECK (reporter_trust BETWEEN 0 AND 3);
ALTER TABLE reports ADD COLUMN alerts_held boolean NOT NULL DEFAULT false;
-- Vom Admin geprüft (wiederhergestellt / Markierungen verworfen): Stimmen blenden nicht mehr automatisch aus
ALTER TABLE reports ADD COLUMN reviewed_at timestamptz;

-- Stimmen von Konten mit deutlich negativem Vertrauen zählen nur halb fürs automatische Ausblenden
ALTER TABLE report_votes ADD COLUMN weight real NOT NULL DEFAULT 1;

-- Automatische Drosselung bei wiederholt falschen Meldungen
ALTER TABLE users ADD COLUMN restricted_until timestamptz;
ALTER TABLE users ADD COLUMN restriction_lifted_at timestamptz;

-- Antworten des Teams auf Feedback (per E-Mail verschickt)
CREATE TABLE feedback_replies (
  id           bigserial PRIMARY KEY,
  feedback_id  bigint NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  admin_uid    text,
  message      text NOT NULL CHECK (char_length(message) <= 3000)
);
CREATE INDEX feedback_replies_feedback_idx ON feedback_replies (feedback_id, created_at);
