-- No-op: 000097 only moved system-derived entry dates to the correct
-- Europe/Istanbul business day. Restoring the previous (UTC) day would put
-- the bug back, so the down migration intentionally changes nothing.
SELECT 1;
