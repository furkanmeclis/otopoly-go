-- Data loss: every non-Turkish template row (and its Meta state) is dropped.
DELETE FROM whatsapp_cloud_templates WHERE language <> 'tr';

ALTER TABLE whatsapp_cloud_templates
    DROP CONSTRAINT uq_whatsapp_cloud_templates_key_language;

ALTER TABLE whatsapp_cloud_templates
    ADD CONSTRAINT uq_whatsapp_cloud_templates_key UNIQUE (key);
