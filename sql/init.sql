-- LoveType 데이터베이스 초기화

CREATE TABLE IF NOT EXISTS mbti_results (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  ip_hash VARCHAR(64) NOT NULL,
  mbti_type VARCHAR(4) NOT NULL,
  scores JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compatibility_cache (
  id SERIAL PRIMARY KEY,
  type_a VARCHAR(4) NOT NULL,
  type_b VARCHAR(4) NOT NULL,
  result_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(type_a, type_b)
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64),
  ip_hash VARCHAR(64),
  event_type VARCHAR(64) NOT NULL,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_stats (
  id SERIAL PRIMARY KEY,
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  mbti_type VARCHAR(4),
  count INTEGER DEFAULT 0,
  UNIQUE(stat_date, mbti_type)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  ip_hash VARCHAR(64) NOT NULL,
  endpoint VARCHAR(128) NOT NULL,
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(ip_hash, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_mbti_results_ip_hash ON mbti_results(ip_hash);
CREATE INDEX IF NOT EXISTS idx_mbti_results_created_at ON mbti_results(created_at);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date);
