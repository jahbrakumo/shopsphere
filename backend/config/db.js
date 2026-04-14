// ============================================
// SHOPSPHERE — db.js
// PostgreSQL connection pool via pg
// ============================================

import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || "shopsphere",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  max:      20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

pool.on("error", (err) => {
  console.error("Unexpected DB pool error:", err);
});

export async function connectDB() {
  const client = await pool.connect();
  console.log(`✅  PostgreSQL connected → ${process.env.DB_NAME || "shopsphere"}`);
  client.release();
}

// ── Helper: tagged-template query ────────────────────────────
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === "development") {
    console.log("query", { text, duration, rows: res.rowCount });
  }
  return res;
}

// ── Helper: transaction wrapper ───────────────────────────────
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}