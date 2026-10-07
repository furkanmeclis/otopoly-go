-- Drops every legal page (privacy policy text edited by the admin is lost).
DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN ('platform.legal.read', 'platform.legal.write'));
DELETE FROM permissions WHERE slug IN ('platform.legal.read', 'platform.legal.write');

DROP TABLE IF EXISTS legal_pages;
