import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

/** Apply db/schema.sql to the database in DATABASE_URL. Idempotent (IF NOT EXISTS). */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing to migrate (app runs in-memory).");
  process.exit(0);
}

const sql = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");
const pool = new Pool({ connectionString: url });
try {
  await pool.query(sql);
  console.log("Schema applied.");
} finally {
  await pool.end();
}
