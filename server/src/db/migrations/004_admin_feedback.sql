-- Admin-Bereich: Protokoll aller Admin-Aktionen und Anmeldeversuche
CREATE TABLE admin_audit (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  uid        text,
  action     text NOT NULL,
  target     text,
  detail     jsonb,
  ip         text
);
CREATE INDEX admin_audit_at_idx ON admin_audit (at DESC);

-- Feedback aus der App (nur für das Catch-Team sichtbar)
CREATE TABLE feedback (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       text REFERENCES users(id) ON DELETE SET NULL,
  category      text NOT NULL CHECK (category IN ('BUG', 'IDEA', 'PRAISE', 'OTHER')),
  message       text NOT NULL,
  rating        smallint CHECK (rating BETWEEN 1 AND 5),
  allow_contact boolean NOT NULL DEFAULT false,
  app_version   text,
  platform      text CHECK (platform IN ('ios', 'android', 'web')),
  lang          text,
  status        text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'READ', 'DONE'))
);
CREATE INDEX feedback_status_idx ON feedback (status, created_at DESC);
