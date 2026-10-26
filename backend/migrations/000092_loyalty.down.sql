-- Drops every loyalty record (campaigns, stamps, packages sold, subscriptions
-- and their payments). Job lines lose the loyalty discount columns; their
-- line_total keeps the discounted value.
ALTER TABLE service_job_lines
    DROP CONSTRAINT IF EXISTS chk_service_job_lines_discount_source,
    DROP CONSTRAINT IF EXISTS chk_service_job_lines_discount,
    DROP COLUMN IF EXISTS discount_source,
    DROP COLUMN IF EXISTS discount_amount;

DROP TABLE IF EXISTS loyalty_applications;
DROP TABLE IF EXISTS loyalty_subscription_payments;
DROP TABLE IF EXISTS loyalty_subscriptions;
DROP TABLE IF EXISTS loyalty_subscription_plans;
DROP TABLE IF EXISTS loyalty_customer_package_credits;
DROP TABLE IF EXISTS loyalty_customer_packages;
DROP TABLE IF EXISTS loyalty_package_items;
DROP TABLE IF EXISTS loyalty_packages;
DROP TABLE IF EXISTS loyalty_stamp_events;
DROP TABLE IF EXISTS loyalty_campaigns;
