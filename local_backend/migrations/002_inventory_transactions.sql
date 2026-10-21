CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  transaction_type TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity >= 0 AND quantity <> 'NaN'::numeric),
  transaction_date TIMESTAMPTZ NOT NULL,
  value NUMERIC NOT NULL CHECK (value >= 0 AND value <> 'NaN'::numeric),
  category TEXT NOT NULL,
  shipping_method TEXT,
  source_reference TEXT
);
CREATE INDEX transactions_product_date ON transactions(product_id, transaction_date);

ALTER TABLE products DROP COLUMN category;

ALTER TABLE inventory DROP CONSTRAINT inventory_pkey;
ALTER TABLE inventory ADD COLUMN initial_quantity NUMERIC;
UPDATE inventory i
SET initial_quantity = (
  SELECT s.inventory_level
  FROM snapshots s
  WHERE s.store_id = i.store_id AND s.product_id = i.product_id
  ORDER BY s.snapshot_date, s.id
  LIMIT 1
);
ALTER TABLE inventory ALTER COLUMN initial_quantity SET NOT NULL;
ALTER TABLE inventory ADD CONSTRAINT inventory_initial_quantity_nonnegative
  CHECK (initial_quantity >= 0 AND initial_quantity <> 'NaN'::numeric);
ALTER TABLE inventory ADD COLUMN default_shipping_method TEXT;
ALTER TABLE inventory ADD CONSTRAINT inventory_product_pkey PRIMARY KEY(product_id);

ALTER TABLE jobs DROP CONSTRAINT jobs_run_id_key;
CREATE INDEX jobs_run ON jobs(run_id, created_at DESC);

ALTER TABLE results ADD COLUMN anomaly_severity SMALLINT NOT NULL DEFAULT 0
  CHECK (anomaly_severity IN (0,1));
