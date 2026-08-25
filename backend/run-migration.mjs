import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  console.error('Please set it first:');
  console.error('  PowerShell: $env:DATABASE_URL = "postgresql://..."');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  console.log('🔌 Connecting to database...');
  await client.connect();
  console.log('✅ Connected');

  const migrationPath = join(__dirname, 'migrations', '0004_add-bot-support.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  console.log('📝 Running migration 0004_add-bot-support.sql...');
  await client.query(sql);
  console.log('✅ Migration completed successfully');

  // Verify the column was added
  const { rows } = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'players' AND column_name = 'is_bot'
  `);

  if (rows.length > 0) {
    console.log('\n📊 Verification:');
    console.log('   Column: is_bot');
    console.log('   Type:', rows[0].data_type);
    console.log('   Nullable:', rows[0].is_nullable);
    console.log('   Default:', rows[0].column_default || '(none)');
    console.log('\n✅ Bot support is now enabled!');
  } else {
    console.warn('⚠️  Warning: Column is_bot not found after migration');
  }
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
