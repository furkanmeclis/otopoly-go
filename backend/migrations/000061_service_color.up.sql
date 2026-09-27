-- Palette key used to tag services on job cards (empty = derived from name).
ALTER TABLE services ADD COLUMN IF NOT EXISTS color VARCHAR(16) NOT NULL DEFAULT '';
