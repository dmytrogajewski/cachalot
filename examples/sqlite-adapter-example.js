const { Cache, SQLiteStorageAdapter } = require('../dist');

async function sqliteAdapterExample() {
  // Create SQLite adapter
  const sqliteAdapter = new SQLiteStorageAdapter({
    databasePath: './cache.db',
    tableName: 'my_cache'
  });

  // Initialize the adapter
  await sqliteAdapter.initialize();

  // Create cache with SQLite adapter
  const cache = new Cache({
    storage: sqliteAdapter,
    defaultTTL: 60000 // 1 minute
  });

  console.log('SQLite Cache Example');
  console.log('===================');

  // Set some values
  await cache.set('user:1', { id: 1, name: 'John Doe', email: 'john@example.com' });
  await cache.set('user:2', { id: 2, name: 'Jane Smith', email: 'jane@example.com' });
  await cache.set('config:app', { theme: 'dark', language: 'en', version: '1.0.0' });

  console.log('✅ Set 3 items in cache');

  // Get values
  const user1 = await cache.get('user:1');
  const user2 = await cache.get('user:2');
  const config = await cache.get('config:app');

  console.log('📖 Retrieved items:');
  console.log('  user:1:', user1);
  console.log('  user:2:', user2);
  console.log('  config:app:', config);

  // Set with custom TTL
  await cache.set('temp:session', { userId: 123, token: 'abc123' }, 5000); // 5 seconds
  console.log('⏰ Set temporary session (5s TTL)');

  // Wait a bit and check if it's still there
  await new Promise(resolve => setTimeout(resolve, 2000));
  const session = await cache.get('temp:session');
  console.log('⏱️  Session after 2s:', session ? 'still exists' : 'expired');

  // Wait for expiration
  await new Promise(resolve => setTimeout(resolve, 4000));
  const expiredSession = await cache.get('temp:session');
  console.log('⏱️  Session after 6s:', expiredSession ? 'still exists' : 'expired');

  // Test locking
  const lockAcquired = await sqliteAdapter.acquireLock('user:1', 10000);
  console.log('🔒 Lock acquired for user:1:', lockAcquired);

  if (lockAcquired) {
    const lockExists = await sqliteAdapter.isLockExists('user:1');
    console.log('🔍 Lock exists:', lockExists);

    // Release lock
    const lockReleased = await sqliteAdapter.releaseLock('user:1');
    console.log('🔓 Lock released:', lockReleased);
  }

  // Cleanup
  await sqliteAdapter.cleanup();
  await sqliteAdapter.close();
  
  console.log('🧹 Cleanup completed');
  console.log('✅ SQLite adapter example completed');
}

// Run the example
sqliteAdapterExample().catch(console.error); 