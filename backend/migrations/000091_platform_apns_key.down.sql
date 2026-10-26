-- Drops the admin-uploaded APNs key (the APNS_* env fallback keeps working).
DROP TABLE IF EXISTS platform_apns_settings;
