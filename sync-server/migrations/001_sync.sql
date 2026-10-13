CREATE TABLE IF NOT EXISTS sync_stores (
  store_id UUID PRIMARY KEY,
  store_name TEXT NOT NULL CHECK (length(trim(store_name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_store_settings (
  store_id UUID PRIMARY KEY REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  settings JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_counters (
  counter_id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  token_hash BYTEA NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_counters_store_idx ON sync_counters(store_id);

CREATE TABLE IF NOT EXISTS sync_events (
  counter_id UUID NOT NULL REFERENCES sync_counters(counter_id) ON DELETE RESTRICT,
  event_id UUID NOT NULL,
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (counter_id, event_id)
);
CREATE INDEX IF NOT EXISTS sync_events_store_received_idx ON sync_events(store_id, received_at DESC);
CREATE INDEX IF NOT EXISTS sync_events_aggregate_idx ON sync_events(store_id, aggregate_type, aggregate_id);

CREATE TABLE IF NOT EXISTS sync_products (
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  product_snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id)
);

CREATE TABLE IF NOT EXISTS sync_inventory (
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  on_hand_quantity_milli BIGINT NOT NULL DEFAULT 0 CHECK (on_hand_quantity_milli >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id),
  FOREIGN KEY (store_id, product_id) REFERENCES sync_products(store_id, product_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_allocations (
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  counter_id UUID NOT NULL REFERENCES sync_counters(counter_id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  allocated_quantity_milli BIGINT NOT NULL CHECK (allocated_quantity_milli >= 0),
  remaining_quantity_milli BIGINT NOT NULL CHECK (remaining_quantity_milli >= 0 AND remaining_quantity_milli <= allocated_quantity_milli),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (counter_id, product_id),
  FOREIGN KEY (store_id, product_id) REFERENCES sync_products(store_id, product_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sync_allocations_store_product_idx ON sync_allocations(store_id, product_id);

CREATE TABLE IF NOT EXISTS sync_stock_movements (
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  counter_id UUID NOT NULL REFERENCES sync_counters(counter_id) ON DELETE RESTRICT,
  movement_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity_delta_milli BIGINT NOT NULL CHECK (quantity_delta_milli <> 0),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (counter_id, movement_id),
  FOREIGN KEY (store_id, product_id) REFERENCES sync_products(store_id, product_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_sales (
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  counter_id UUID NOT NULL REFERENCES sync_counters(counter_id) ON DELETE RESTRICT,
  sale_id UUID NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (counter_id, sale_id)
);

CREATE TABLE IF NOT EXISTS sync_returns (
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  counter_id UUID NOT NULL REFERENCES sync_counters(counter_id) ON DELETE RESTRICT,
  return_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('return','void')),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (counter_id, return_id),
  FOREIGN KEY (counter_id, sale_id) REFERENCES sync_sales(counter_id, sale_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_return_lines (
  counter_id UUID NOT NULL,
  return_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity_milli BIGINT NOT NULL CHECK (quantity_milli > 0),
  PRIMARY KEY (counter_id, return_id, product_id),
  FOREIGN KEY (counter_id, return_id) REFERENCES sync_returns(counter_id, return_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sync_return_lines_sale_product_idx ON sync_return_lines(counter_id, sale_id, product_id);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id BIGSERIAL PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES sync_stores(store_id) ON DELETE RESTRICT,
  counter_id UUID NOT NULL REFERENCES sync_counters(counter_id) ON DELETE RESTRICT,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (counter_id, event_id)
);
CREATE INDEX IF NOT EXISTS sync_conflicts_open_idx ON sync_conflicts(store_id, created_at DESC) WHERE resolved_at IS NULL;
