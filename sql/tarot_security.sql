-- Additive migration: preserve existing wallets and readings.
ALTER TABLE lovetype_tarot_readings ADD COLUMN IF NOT EXISTS client_reading_id VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tarot_reading_request ON lovetype_tarot_readings(app_id,user_id,client_reading_id);
CREATE TABLE IF NOT EXISTS lovetype_tarot_verified_purchases (
  receipt_key CHAR(64) PRIMARY KEY,
  user_id VARCHAR(256) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
