const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  try {
    const sqlPath = path.join(__dirname, "database.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");

    await pool.query(sql);
    console.log("Database tables created successfully.");
  } catch (err) {
    console.error("Error initializing database:", err.message);
  } finally {
    await pool.end();
  }
}

initDb();