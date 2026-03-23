-- LoveType DB init.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. 세션 로그
CREATE TABLE IF NOT EXISTS svil_sessions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id               VARCHAR(30)   NOT NULL,
  session_id           VARCHAR(64)   NOT NULL,
  ip_hash              VARCHAR(64)   NOT NULL,
  country              VARCHAR(10),
  referrer             VARCHAR(255),
  referrer_type        VARCHAR(30),
  device_type          VARCHAR(20),
  user_agent_summary   VARCHAR(100),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  date_kst             DATE          NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_app_date   ON svil_sessions(app_id, date_kst);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON svil_sessions(session_id);

-- 2. 행동 이벤트
CREATE TABLE IF NOT EXISTS svil_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id   VARCHAR(64)   NOT NULL,
  app_id       VARCHAR(30)   NOT NULL,
  event_type   VARCHAR(50)   NOT NULL,
  event_value  VARCHAR(255),
  step         INTEGER,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_session   ON svil_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_app_type  ON svil_events(app_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_created   ON svil_events(created_at);

-- 3. MBTI 결과 저장 + 하루 제한
CREATE TABLE IF NOT EXISTS svil_results (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id               VARCHAR(30)   NOT NULL,
  session_id           VARCHAR(64)   NOT NULL,
  cache_key            VARCHAR(128)  NOT NULL,
  mbti                 VARCHAR(4)    NOT NULL,
  axis_strength        JSONB         NOT NULL,
  result_data          JSONB,
  compatibility_data   JSONB,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  date_kst             DATE          NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_session_date ON svil_results(session_id, app_id, date_kst);
CREATE INDEX IF NOT EXISTS idx_results_cache_key    ON svil_results(cache_key);
CREATE INDEX IF NOT EXISTS idx_results_mbti         ON svil_results(mbti);

-- 4. 일별 집계
CREATE TABLE IF NOT EXISTS svil_stats_daily (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id            VARCHAR(30)   NOT NULL,
  date_kst          DATE          NOT NULL,
  total_sessions    INTEGER       NOT NULL DEFAULT 0,
  test_starts       INTEGER       NOT NULL DEFAULT 0,
  test_completes    INTEGER       NOT NULL DEFAULT 0,
  tarot_cta_clicks  INTEGER       NOT NULL DEFAULT 0,
  shares            INTEGER       NOT NULL DEFAULT 0,
  top_mbti          VARCHAR(4)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_daily_unique ON svil_stats_daily(app_id, date_kst);

-- 5. AI 궁합 캐시 (256개 조합)
CREATE TABLE IF NOT EXISTS svil_compatibility_cache (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id         VARCHAR(30)   NOT NULL,
  cache_key      VARCHAR(128)  NOT NULL,
  mbti           VARCHAR(4)    NOT NULL,
  axis_strength  JSONB         NOT NULL,
  result_data    JSONB         NOT NULL,
  slot           SMALLINT      NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_compat_cache_key_slot ON svil_compatibility_cache(app_id, cache_key, slot);
CREATE INDEX IF NOT EXISTS idx_compat_cache_key ON svil_compatibility_cache(app_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_compat_mbti      ON svil_compatibility_cache(mbti);

-- LoveType-Tarot /api/v1 (app_id: lovetype-tarot)
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
