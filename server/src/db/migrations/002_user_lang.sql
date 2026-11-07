-- Sprache des Nutzers (für Push-Benachrichtigungen in seiner Sprache)
ALTER TABLE users ADD COLUMN lang text NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'de'));
