-- Pendler-Modus: gespeicherte Strecken ("Zuhause → Arbeit, werktags 7:30").
-- Der Server plant die Verbindung selbst, legt dafür automatische Trackings an und schickt
-- eine "Zeit zu gehen"-Erinnerung. Dafür liegen Start und Ziel (bei Adressen inkl. Koordinaten)
-- hier – gelöscht mit der Strecke oder dem Konto (ON DELETE CASCADE).
CREATE TABLE commutes (
  id              bigserial PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  -- {kind, id, name, lat, lon}; id = Stop-ID oder "geo:<lat>,<lon>"
  from_place      jsonb NOT NULL,
  to_place        jsonb NOT NULL,
  -- Bit 0 = Montag … Bit 6 = Sonntag (31 = Mo–Fr)
  weekdays        smallint NOT NULL CHECK (weekdays BETWEEN 1 AND 127),
  -- "HH:MM" Ortszeit Europe/Berlin
  time            text NOT NULL CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_mode       text NOT NULL DEFAULT 'depart' CHECK (time_mode IN ('depart', 'arrive')),
  active          boolean NOT NULL DEFAULT true,
  -- Bei welchen Arten alarmiert wird (leer = alle), wie bei Trackings
  kinds           text[] NOT NULL DEFAULT '{}',
  -- Erinnerung X Minuten vor dem Losgehen (NULL = aus)
  remind_minutes  smallint CHECK (remind_minutes BETWEEN 1 AND 60),
  -- Zuletzt berechnete Verbindung (CommutePlan) und wann sie berechnet wurde
  plan            jsonb,
  planned_at      timestamptz,
  -- Zuletzt bekannte Fahrtdauer (Minuten) – damit "Ankunft bis" rechtzeitig beobachtet wird
  last_duration_min smallint,
  -- Stand der Benachrichtigungen für den aktuellen Termin (gegen doppelte Pushes)
  notify_state    jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commutes_user_idx ON commutes (user_id);
CREATE INDEX commutes_active_idx ON commutes (id) WHERE active;

-- Automatische Trackings aus dem Pendler-Modus (werden in der Liste der Live-Trackings nicht gezeigt)
ALTER TABLE trackings ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'commute'));
ALTER TABLE trackings ADD COLUMN commute_id bigint REFERENCES commutes(id) ON DELETE CASCADE;
CREATE INDEX trackings_commute_idx ON trackings (commute_id, ends_at) WHERE commute_id IS NOT NULL;
