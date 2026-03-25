-- Admin-tunable cooldown + deck flags (LoveType-Tarot)
CREATE TABLE IF NOT EXISTS lovetype_tarot_settings (
  app_id VARCHAR(64) PRIMARY KEY,
  cooldown_daily_sec INTEGER NOT NULL DEFAULT 3600,
  cooldown_romance_sec INTEGER NOT NULL DEFAULT 3600,
  deck_basic_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deck_low_vision_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deck_webtoon_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lovetype_tarot_settings (app_id)
VALUES ('lovetype-tarot')
ON CONFLICT (app_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS lovetype_tarot_charge_log (
  id BIGSERIAL PRIMARY KEY,
  app_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(256) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  is_subscription BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_charge_log_created
  ON lovetype_tarot_charge_log (app_id, created_at DESC);
