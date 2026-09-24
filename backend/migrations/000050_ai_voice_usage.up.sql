-- AI assistant (phase 4): voice metering in the usage ledger.
-- Speech-to-text rows record the transcribed audio length (audio_ms) and
-- text-to-speech rows the synthesized characters; both carry zero tokens, so
-- they never count against the monthly token quota.

ALTER TABLE ai_usage
    ADD COLUMN audio_ms   BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN characters BIGINT NOT NULL DEFAULT 0;

ALTER TABLE ai_usage DROP CONSTRAINT chk_ai_usage_purpose;
ALTER TABLE ai_usage
    ADD CONSTRAINT chk_ai_usage_purpose CHECK (purpose IN ('chat', 'title', 'test', 'stt', 'tts'));

-- Stale "executing" actions (server stopped mid-execution) are swept by status.
CREATE INDEX idx_ai_pending_actions_executing
    ON ai_pending_actions (updated_at)
    WHERE status = 'executing';
