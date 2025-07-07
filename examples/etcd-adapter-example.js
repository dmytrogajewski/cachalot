const { Cache, EtcdStorageAdapter } = require('../dist');

async function etcdExample() {
  // Create Etcd adapter with configuration
  const etcdAdapter = new EtcdStorageAdapter({
    hosts: ['localhost:2379'],
    credentials: {
      rootCertificate: Buffer.from('your-root-cert'),
      privateKey: Buffer.from('your-private-key'),
      certChain: Buffer.from('your-cert-chain')
    },
    namespace: 'my_app',
    logger: console
  });

  // Initialize the adapter
  await etcdAdapter.initialize();

  // Create cache with Etcd adapter
  const cache = new Cache({
    storageAdapter: etcdAdapter,
    defaultTTL: 300000, // 5 minutes
    logger: console
  });

  try {
    // Set a value
    await cache.set('config:database', JSON.stringify({
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      username: 'postgres'
    }), 1800000); // 30 minutes TTL

    // Get the value
    const config = await cache.get('config:database');
    console.log('Retrieved config:', config);

    // Set multiple values
    const configs = new Map([
      ['config:redis', JSON.stringify({ host: 'localhost', port: 6379 })],
      ['config:api', JSON.stringify({ port: 3000, cors: true })]
    ]);
    await cache.mset(configs);

    // Get multiple values
    const retrievedConfigs = await cache.mget(['config:redis', 'config:api']);
    console.log('Retrieved configs:', retrievedConfigs);

    // Delete a value
    const deleted = await cache.del('config:database');
    console.log('Deleted config:database:', deleted);

    // Use locking for configuration updates
    const lockAcquired = await cache.acquireLock('config:update');
    if (lockAcquired) {
      console.log('Lock acquired for config:update');
      
      // Simulate configuration update
      const currentVersion = await cache.get('config:version') || '1.0.0';
      const newVersion = '1.1.0';
      await cache.set('config:version', newVersion, 86400000); // 24 hours
      
      console.log(`Updated config version: ${currentVersion} -> ${newVersion}`);
      
      // Release the lock
      await cache.releaseLock('config:update');
      console.log('Lock released for config:update');
    } else {
      console.log('Failed to acquire lock for config:update');
    }

    // Check if lock exists
    const lockExists = await cache.isLockExists('config:update');
    console.log('Lock exists for config:update:', lockExists);

    // Use namespace isolation
    console.log('All keys are prefixed with "my_app:" namespace');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    await cache.close();
  }
}

// Run the example
etcdExample().catch(console.error); 