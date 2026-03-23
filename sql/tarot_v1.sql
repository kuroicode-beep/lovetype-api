-- LoveType-Tarot /api/v1 (app_id: lovetype-tarot)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS lovetype_tarot_users (
  app_id      VARCHAR(64)  NOT NULL,
  user_id     VARCHAR(256) NOT NULL,
  nickname    VARCHAR(100),
  gender      VARCHAR(10),
  mbti        VARCHAR(8),
  soul_card   SMALLINT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

CREATE TABLE IF NOT EXISTS lovetype_tarot_wallet (
  app_id          VARCHAR(64)  NOT NULL,
  user_id         VARCHAR(256) NOT NULL,
  balance         INTEGER      NOT NULL DEFAULT 0,
  is_subscribed   BOOLEAN      NOT NULL DEFAULT FALSE,
  sub_expires_at  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

CREATE TABLE IF NOT EXISTS lovetype_tarot_readings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id       VARCHAR(64)  NOT NULL,
  user_id      VARCHAR(256) NOT NULL,
  reading_date DATE,
  theme        VARCHAR(100),
  tags         JSONB,
  cards        JSONB,
  story        TEXT,
  soul_card    SMALLINT,
  mbti         VARCHAR(8),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tarot_readings_user_created
  ON lovetype_tarot_readings(app_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lovetype_tarot_push (
  app_id     VARCHAR(64) NOT NULL,
  user_id    VARCHAR(256) NOT NULL,
  fcm_token  TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

CREATE TABLE IF NOT EXISTS lovetype_tarot_cooldown (
  app_id    VARCHAR(64) NOT NULL,
  user_id   VARCHAR(256) NOT NULL,
  category  VARCHAR(32) NOT NULL,
  last_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app_id, user_id, category)
);
