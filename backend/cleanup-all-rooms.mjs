import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Eliminar TODAS las salas waiting (limpieza completa)
const result = await pool.query("DELETE FROM rooms WHERE status = 'waiting'");
console.log('Salas waiting eliminadas:', result.rowCount);

// También eliminar salas finished e in_progress viejas (más de 1 hora)
const old = await pool.query("DELETE FROM rooms WHERE created_at < NOW() - INTERVAL '1 hour'");
console.log('Salas viejas eliminadas:', old.rowCount);

// Verificar estado final
const remaining = await pool.query("SELECT status, COUNT(*) FROM rooms GROUP BY status");
console.log('Estado actual:', remaining.rows);

await pool.end();
