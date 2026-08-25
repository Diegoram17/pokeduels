import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Eliminar todas las salas de prueba (waiting con menos de 2 jugadores o creadas hace más de 30 min)
const result = await pool.query(`
  DELETE FROM rooms 
  WHERE status = 'waiting' 
    AND (
      created_at < NOW() - INTERVAL '30 minutes'
      OR (SELECT COUNT(*) FROM room_players WHERE room_id = rooms.id) < 2
    )
`);
console.log('Salas eliminadas:', result.rowCount);

// Verificar cuántas quedan
const remaining = await pool.query("SELECT COUNT(*) FROM rooms WHERE status = 'waiting'");
console.log('Salas waiting restantes:', remaining.rows[0].count);

await pool.end();
