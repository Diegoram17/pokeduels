import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const result = await pool.query(`
  SELECT 
    id, 
    code, 
    status, 
    created_at,
    EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as hours_old,
    (SELECT COUNT(*) FROM room_players WHERE room_id = rooms.id) as player_count
  FROM rooms 
  ORDER BY created_at DESC
  LIMIT 10
`);
console.log(JSON.stringify(result.rows, null, 2));
await pool.end();
