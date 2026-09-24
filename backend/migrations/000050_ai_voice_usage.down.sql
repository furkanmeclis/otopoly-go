-- Removes voice metering rows and columns from the usage ledger.

DROP INDEX IF EXISTS idx_ai_pending_actions_executing;

DELETE FROM ai_usage WHERE purpose IN ('stt', 'tts');

ALTER TABLE ai_usage DROP CONSTRAINT chk_ai_usage_purpose;
ALTER TABLE ai_usage
    ADD CONSTRAINT chk_ai_usage_purpose CHECK (purpose IN ('chat', 'title', 'test'));

ALTER TABLE ai_usage
    DROP COLUMN IF EXISTS characters,
    DROP COLUMN IF EXISTS audio_ms;
