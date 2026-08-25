// Prueba completa del flujo de creación de sala
const API_BASE = 'https://pokeduels-backend.onrender.com';

async function testFlow() {
  console.log('=== PRUEBA DE FLUJO COMPLETO ===\n');
  
  // 1. Crear sesión
  console.log('1. Creando sesión...');
  const sessionRes = await fetch(`${API_BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'TestUser' })
  });
  
  if (!sessionRes.ok) {
    console.error('❌ Error creando sesión:', sessionRes.status);
    return;
  }
  
  const session = await sessionRes.json();
  console.log('✅ Sesión creada:', { playerId: session.playerId, token: session.sessionToken.substring(0, 20) + '...' });
  
  // 2. Crear sala con el token
  console.log('\n2. Creando sala con token...');
  const roomRes = await fetch(`${API_BASE}/api/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.sessionToken}`
    },
    body: JSON.stringify({ max_players: 2 })
  });
  
  if (!roomRes.ok) {
    const error = await roomRes.text();
    console.error('❌ Error creando sala:', roomRes.status, error);
    return;
  }
  
  const room = await roomRes.json();
  console.log('✅ Sala creada:', room);
  
  // 3. Verificar que la sala aparece en el listado
  console.log('\n3. Verificando listado de salas...');
  const listRes = await fetch(`${API_BASE}/api/rooms`);
  const rooms = await listRes.json();
  console.log(`✅ Salas en listado: ${rooms.length}`);
  const found = rooms.find(r => r.code === room.code);
  console.log(found ? `✅ Sala ${room.code} encontrada en listado` : `❌ Sala ${room.code} NO encontrada`);
  
  console.log('\n=== PRUEBA COMPLETADA ===');
}

testFlow().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
