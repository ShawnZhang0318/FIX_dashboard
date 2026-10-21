CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL CHECK (store_id = 'S001'),
  product_id TEXT NOT NULL REFERENCES products(id),
  snapshot_date DATE NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[a-fA-F0-9]{64}$'),
  inventory_level NUMERIC NOT NULL CHECK (
    inventory_level >= 0 AND inventory_level <> 'NaN'::numeric
  ),
  units_sold NUMERIC NOT NULL CHECK (
    units_sold >= 0 AND units_sold <> 'NaN'::numeric
  ),
  units_ordered NUMERIC NOT NULL CHECK (
    units_ordered >= 0 AND units_ordered <> 'NaN'::numeric
  ),
  price NUMERIC NOT NULL CHECK (
    price >= 0 AND price <> 'NaN'::numeric
  ),
  discount NUMERIC NOT NULL CHECK (
    discount >= 0 AND discount <> 'NaN'::numeric
  ),
  weather_condition TEXT NOT NULL,
  holiday_promotion SMALLINT NOT NULL CHECK (holiday_promotion IN (0,1)),
  competitor_pricing NUMERIC NOT NULL CHECK (
    competitor_pricing >= 0 AND competitor_pricing <> 'NaN'::numeric
  ),
  seasonality TEXT NOT NULL,
  demand_forecast_benchmark NUMERIC NOT NULL CHECK (
    demand_forecast_benchmark <> 'NaN'::numeric
  ),
  source_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  data TEXT NOT NULL,
  CONSTRAINT snapshots_store_product_date UNIQUE(store_id, product_id, snapshot_date)
);

CREATE TABLE inventory (
  store_id TEXT NOT NULL CHECK (store_id = 'S001'),
  product_id TEXT NOT NULL REFERENCES products(id),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  snapshot_date DATE NOT NULL,
  on_hand_quantity NUMERIC NOT NULL CHECK (
    on_hand_quantity >= 0 AND on_hand_quantity <> 'NaN'::numeric
  ),
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days > 0),
  safety_stock NUMERIC CHECK (
    safety_stock >= 0 AND safety_stock <> 'NaN'::numeric
  ),
  updated_at TIMESTAMPTZ NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(store_id, product_id)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL CHECK (store_id = 'S001'),
  run_type TEXT NOT NULL CHECK (run_type IN ('daily','monthly')),
  as_of_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','completed','failed')),
  input_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  data TEXT NOT NULL,
  frozen_input TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
  job_type TEXT NOT NULL CHECK (job_type IN ('forecast')),
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX pending_jobs ON jobs(status, created_at);

CREATE TABLE results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  store_id TEXT NOT NULL CHECK (store_id = 'S001'),
  product_id TEXT NOT NULL REFERENCES products(id),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  horizon_days INTEGER NOT NULL CHECK (horizon_days > 0),
  predicted_demand_p50 NUMERIC NOT NULL CHECK (
    predicted_demand_p50 >= 0 AND predicted_demand_p50 <> 'NaN'::numeric
  ),
  predicted_demand_p90 NUMERIC NOT NULL CHECK (
    predicted_demand_p90 >= predicted_demand_p50 AND predicted_demand_p90 <> 'NaN'::numeric
  ),
  inventory_at_prediction NUMERIC NOT NULL CHECK (
    inventory_at_prediction >= 0 AND inventory_at_prediction <> 'NaN'::numeric
  ),
  safety_stock NUMERIC NOT NULL CHECK (
    safety_stock >= 0 AND safety_stock <> 'NaN'::numeric
  ),
  recommended_order_quantity NUMERIC NOT NULL CHECK (
    recommended_order_quantity >= 0 AND recommended_order_quantity <> 'NaN'::numeric
  ),
  anomaly_score NUMERIC NOT NULL CHECK (
    anomaly_score >= 0 AND anomaly_score <> 'NaN'::numeric
  ),
  anomaly_type TEXT,
  anomaly_threshold NUMERIC NOT NULL CHECK (
    anomaly_threshold >= 0 AND anomaly_threshold <> 'NaN'::numeric
  ),
  explanation TEXT NOT NULL,
  model_version TEXT NOT NULL,
  input_reference TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  duration_ms NUMERIC NOT NULL CHECK (
    duration_ms >= 0 AND duration_ms <> 'NaN'::numeric
  ),
  data TEXT NOT NULL,
  CONSTRAINT results_run_store_product UNIQUE(run_id, store_id, product_id)
);

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  result_id TEXT NOT NULL UNIQUE REFERENCES results(id),
  exception_type TEXT NOT NULL CHECK (exception_type IN ('reorder','anomaly','reorder_and_anomaly')),
  status TEXT NOT NULL CHECK (status IN ('pending_review','approved','modified','rejected','resolved')),
  reviewer_decision TEXT CHECK (reviewer_decision IN ('approve','modify','reject','resolve')),
  reviewer_order_quantity NUMERIC CHECK (
    reviewer_order_quantity IS NULL OR
    (reviewer_order_quantity >= 0 AND reviewer_order_quantity <> 'NaN'::numeric)
  ),
  reviewer_identity TEXT,
  override_reason TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE logs (
  sequence BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL
);
CREATE TABLE log_queries (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  filters TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
