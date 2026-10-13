CREATE TABLE IF NOT EXISTS sync_stores (
  store_id UUID PRIMARY KEY,
  store_name TEXT NOT NULL CHECK (length(trim(store_name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
