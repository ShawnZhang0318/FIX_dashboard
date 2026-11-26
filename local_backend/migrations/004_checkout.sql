CREATE TABLE sales_days(
  store_id TEXT NOT NULL CHECK(store_id='S001'), business_date DATE NOT NULL,
  closed_at TIMESTAMPTZ, summary TEXT, PRIMARY KEY(store_id,business_date),
  CHECK((closed_at IS NULL) = (summary IS NULL))
);
CREATE UNIQUE INDEX sales_one_open ON sales_days(store_id) WHERE closed_at IS NULL;
CREATE TABLE sales_scans(
  scan_id TEXT PRIMARY KEY, store_id TEXT NOT NULL, business_date DATE NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id), created_at TIMESTAMPTZ NOT NULL, receipt TEXT NOT NULL,
  FOREIGN KEY(store_id,business_date) REFERENCES sales_days(store_id,business_date)
);
CREATE INDEX sales_scan_day ON sales_scans(store_id,business_date,product_id);
ALTER TABLE sales_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_scans ENABLE ROW LEVEL SECURITY;
