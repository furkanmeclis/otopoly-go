DELETE FROM message_template_defaults
WHERE event_type IN ('billing.usage_warning', 'billing.limit_full', 'billing.limit_reached', 'billing.subscription_ending');
DELETE FROM message_templates
WHERE event_type IN ('billing.usage_warning', 'billing.limit_full', 'billing.limit_reached', 'billing.subscription_ending');
