const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

require("dotenv").config();

function resolveSqlPath() {
  const argPath = process.argv[2];
  if (!argPath) {
    return path.resolve(__dirname, "..", "sql", "tarot_v1.sql");
  }
  return path.isAbsolute(argPath)
    ? argPath
    : path.resolve(__dirname, "..", argPath);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const sqlPath = resolveSqlPath();
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`SQL file not found: ${sqlPath}`);
  }

  const sql = fs.readFileSync(sqlPath, "utf8");
  if (!sql.trim()) {
    throw new Error(`SQL file is empty: ${sqlPath}`);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("railway.app")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  console.log(`[migrate] applying: ${sqlPath}`);
  await client.connect();
  try {
    await client.query(sql);
    console.log("[migrate] done");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
