ALTER TABLE billing_customers RENAME COLUMN stripe_customer_id TO polar_customer_id;
ALTER TABLE billing_customers RENAME COLUMN stripe_subscription_id TO polar_subscription_id;
