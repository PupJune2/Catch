-- Catch – Grundschema

CREATE TABLE users (
  id              text PRIMARY KEY,               -- Firebase UID
  email           text,
  display_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  banned          boolean NOT NULL DEFAULT false
);

-- Stammdaten der Linien (werden beim ersten Melden/Tracken angelegt)
CREATE TABLE lines (
  line_key        text PRIMARY KEY,               -- z. B. subway:u8:berliner-verkehrsbetriebe
  name            text NOT NULL,
  mode            text NOT NULL,
  operator        text,
  color           text,
  text_color      text,
  route_id        text,                           -- GTFS-Route der letzten Sichtung (nur Info)
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id              bigserial PRIMARY KEY,
  user_id         text REFERENCES users(id) ON DELETE SET NULL,   -- beim Kontolöschen anonymisiert
  line_key        text NOT NULL REFERENCES lines(line_key),
  direction_id    text,
  headsign        text,
  trip_id         text,
  prev_stop_id    text,
  prev_stop_name  text,
  prev_lat        double precision,
  prev_lon        double precision,
  next_stop_id    text,
  next_stop_name  text,
  next_lat        double precision,
  next_lon        double precision,
  tags            text[] NOT NULL DEFAULT '{}',
  reported_at     timestamptz NOT NULL DEFAULT now(),  -- Zeitpunkt der Kontrolle
  created_at      timestamptz NOT NULL DEFAULT now(),  -- Zeitpunkt der Meldung
  confirmations   integer NOT NULL DEFAULT 0,
  denials         integer NOT NULL DEFAULT 0,
  hidden          boolean NOT NULL DEFAULT false,
  CONSTRAINT reports_has_stop CHECK (prev_stop_id IS NOT NULL OR next_stop_id IS NOT NULL)
);
CREATE INDEX reports_line_time_idx ON reports (line_key, reported_at DESC);
CREATE INDEX reports_time_idx ON reports (reported_at DESC);
CREATE INDEX reports_user_time_idx ON reports (user_id, created_at DESC);

CREATE TABLE report_votes (
  report_id       bigint NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value           smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

-- Push-Tokens (Expo) der Geräte
CREATE TABLE devices (
  token           text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON devices (user_id);

-- Live-Trackings: "Benachrichtige mich, wenn auf Linie X zwischen A und B etwas gemeldet wird"
CREATE TABLE trackings (
  id              bigserial PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_key        text NOT NULL REFERENCES lines(line_key),
  direction_id    text,
  headsign        text,
  trip_id         text,
  both_directions boolean NOT NULL DEFAULT false,
  from_stop_id    text,
  from_stop_name  text,
  to_stop_id      text,
  to_stop_name    text,
  stop_ids        text[] NOT NULL DEFAULT '{}',
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trackings_window CHECK (ends_at > starts_at)
);
CREATE INDEX trackings_line_end_idx ON trackings (line_key, ends_at);
CREATE INDEX trackings_user_idx ON trackings (user_id, ends_at DESC);

CREATE TABLE tracking_alerts (
  id              bigserial PRIMARY KEY,
  tracking_id     bigint NOT NULL REFERENCES trackings(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id       bigint NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  on_my_segment   boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracking_id, report_id)
);
CREATE INDEX tracking_alerts_user_idx ON tracking_alerts (user_id, created_at DESC);
