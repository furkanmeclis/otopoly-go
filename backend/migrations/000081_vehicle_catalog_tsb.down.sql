-- Data-loss note: drops the whole TSB vehicle catalog, including kasko value
-- history, display brand merges, renames and logo keys (uploaded logo objects
-- stay in storage). Legacy vehicle_brands / vehicle_models rows stay.
DROP INDEX IF EXISTS uq_vehicle_models_catalog_group;
ALTER TABLE vehicle_models DROP COLUMN IF EXISTS catalog_group_key;
DROP INDEX IF EXISTS uq_vehicle_brands_catalog_display_brand;
ALTER TABLE vehicle_brands DROP COLUMN IF EXISTS catalog_display_brand_id;

DROP TABLE IF EXISTS catalog_imports;
DROP TABLE IF EXISTS catalog_model_rules;
DROP TABLE IF EXISTS catalog_valuations;
DROP TABLE IF EXISTS catalog_types;
DROP TABLE IF EXISTS catalog_models;
DROP TABLE IF EXISTS catalog_brands;
DROP TABLE IF EXISTS catalog_display_brands;
