-- Drops system default templates. Organization overrides are kept; rows
-- deleted by the up migration (unedited copies of defaults) are not restored,
-- the application re-seeds them lazily.
DROP TABLE IF EXISTS message_template_defaults;
