import pg from 'pg';

const { Pool } = pg;

// Shared pool for the whole backend. DATABASE_URL comes from the environment
// (Neon convention in this repo — see .env.example). Tests are gated on
// DATABASE_URL, so a missing value surfaces at query time, not import time.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });