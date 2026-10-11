-- WhatsApp platform templates exist once per language (Meta: one template
-- name, one translation per language). The catalog key alone is no longer
-- unique; (key, language) is.
ALTER TABLE whatsapp_cloud_templates
    DROP CONSTRAINT uq_whatsapp_cloud_templates_key;

ALTER TABLE whatsapp_cloud_templates
    ADD CONSTRAINT uq_whatsapp_cloud_templates_key_language UNIQUE (key, language);
