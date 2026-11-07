-- Hinweis-Arten (Verspätung, Ausfall, Überfüllung, Störung, Kontrolle)
ALTER TABLE reports ADD COLUMN kind text NOT NULL DEFAULT 'CHECK'
  CHECK (kind IN ('DELAY', 'CANCELLED', 'CROWDED', 'DISRUPTION', 'CHECK'));
CREATE INDEX reports_line_kind_time_idx ON reports (line_key, kind, reported_at DESC);

-- "Inhalt melden": eine Markierung pro Nutzer und Meldung; ab 3 wird die Meldung ausgeblendet
ALTER TABLE reports ADD COLUMN flags integer NOT NULL DEFAULT 0;
CREATE TABLE report_flags (
  report_id   bigint NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('WRONG', 'SPAM', 'INAPPROPRIATE', 'OTHER')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

-- Live-Tracking: nur bei bestimmten Arten alarmieren (leer = alle)
ALTER TABLE trackings ADD COLUMN kinds text[] NOT NULL DEFAULT '{}';

-- Zustimmung zu den Nutzungsbedingungen
ALTER TABLE users ADD COLUMN terms_accepted_at timestamptz;
