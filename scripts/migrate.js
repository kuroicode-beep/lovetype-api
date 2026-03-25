const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

require("dotenv").config();

function resolveSqlPaths() {
  const argPath = process.argv[2];
  if (argPath) {
    const p = path.isAbsolute(argPath)
      ? argPath
      : path.resolve(__dirname, "..", argPath);
    return [p];
  }
  const sqlDir = path.resolve(__dirname, "..", "sql");
  return ["tarot_v1.sql", "tarot_settings.sql"].map((f) =>
    path.join(sqlDir, f)
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const sqlPaths = resolveSqlPaths();
  for (const sqlPath of sqlPaths) {
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
    } finally {
      await client.end();
    }
  }
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] failed");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
