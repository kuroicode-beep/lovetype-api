const pool = require('../db');

async function getCachedCompatibility(app_id, cache_key) {
  const result = await pool.query(
    `SELECT result_data FROM svil_compatibility_cache
     WHERE app_id = $1 AND cache_key = $2
     LIMIT 1`,
    [app_id, cache_key]
  );
  return result.rows[0]?.result_data || null;
}

async function setCachedCompatibility(app_id, cache_key, mbti, axis_strength, result_data) {
  await pool.query(
    `INSERT INTO svil_compatibility_cache
      (app_id, cache_key, mbti, axis_strength, result_data, slot)
     VALUES ($1, $2, $3, $4, $5, 1)
     ON CONFLICT (app_id, cache_key, slot) DO NOTHING`,
    [app_id, cache_key, mbti, JSON.stringify(axis_strength), JSON.stringify(result_data)]
  );
}

async function getCacheStats(app_id) {
  const result = await pool.query(
    `SELECT
      COUNT(DISTINCT cache_key) AS filled,
      256 - COUNT(DISTINCT cache_key) AS remaining
     FROM svil_compatibility_cache
     WHERE app_id = $1`,
    [app_id]
  );
  return result.rows[0];
}

module.exports = { getCachedCompatibility, setCachedCompatibility, getCacheStats };
