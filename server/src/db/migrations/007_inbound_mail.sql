-- Empfangene E-Mails (Resend Receiving): Antworten auf Catch-Mails und Mails an die Kontaktadresse.
-- Gespeichert wird nur reiner Text (HTML wird beim Abruf in Text umgewandelt) und von Anhängen nur
-- Name, Typ und Größe – nie deren Inhalt. Wird nach 365 Tagen gelöscht (index.ts).
CREATE TABLE inbound_emails (
  id                text PRIMARY KEY,                                -- E-Mail-ID bei Resend
  received_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'READ', 'DONE', 'SPAM')),
  -- Inhalt bei Resend abgerufen? (Webhook bringt nur Metadaten; Abruf wird bei Fehlern wiederholt)
  content_status    text NOT NULL DEFAULT 'PENDING' CHECK (content_status IN ('PENDING', 'FETCHED', 'FETCH_FAILED')),
  fetch_attempts    smallint NOT NULL DEFAULT 0,
  last_fetch_at     timestamptz,
  fetch_error       text,
  event_type        text,
  from_address      text,
  from_name         text,
  to_addresses      text[] NOT NULL DEFAULT '{}',
  cc_addresses      text[] NOT NULL DEFAULT '{}',
  reply_to          text[] NOT NULL DEFAULT '{}',
  subject           text,
  body_text         text,                                            -- reiner Text, höchstens ~100 KB
  text_truncated    boolean NOT NULL DEFAULT false,
  text_from_html    boolean NOT NULL DEFAULT false,
  message_id        text,
  in_reply_to       text,
  references_header text,
  auth              jsonb,                                           -- {"spf": "pass", "dkim": "pass", "dmarc": "fail"}
  headers           jsonb,                                           -- Auswahl: date, reply-to, auto-submitted, …
  attachments       jsonb NOT NULL DEFAULT '[]',                     -- nur Metadaten (Name, Typ, Größe)
  user_id           text REFERENCES users(id) ON DELETE SET NULL     -- Konto mit derselben Absender-Adresse
);
CREATE INDEX inbound_emails_received_idx ON inbound_emails (received_at DESC, id DESC);
CREATE INDEX inbound_emails_status_idx ON inbound_emails (status, received_at DESC);
CREATE INDEX inbound_emails_from_idx ON inbound_emails (lower(from_address));
CREATE INDEX inbound_emails_user_idx ON inbound_emails (user_id);
CREATE INDEX inbound_emails_pending_idx ON inbound_emails (content_status) WHERE content_status <> 'FETCHED';

-- Antworten des Teams auf empfangene Mails
CREATE TABLE inbound_replies (
  id           bigserial PRIMARY KEY,
  inbound_id   text NOT NULL REFERENCES inbound_emails(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  admin_uid    text,
  message      text NOT NULL CHECK (char_length(message) <= 5000),
  lang         text,
  mail_status  text NOT NULL CHECK (mail_status IN ('SENT', 'FAILED')),
  resend_id    text,                                                 -- ID der verschickten Antwort bei Resend
  message_id   text
);
CREATE INDEX inbound_replies_inbound_idx ON inbound_replies (inbound_id, created_at);

-- Bereits verarbeitete Webhooks (svix-id), damit Wiederholungen von Resend nichts doppelt anlegen.
-- Nach 30 Tagen gelöscht.
CREATE TABLE inbound_webhooks (
  id           text PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now(),
  event_type   text NOT NULL,
  email_id     text
);
CREATE INDEX inbound_webhooks_at_idx ON inbound_webhooks (received_at);

-- Absender einem Konto zuordnen (Groß-/Kleinschreibung egal)
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
