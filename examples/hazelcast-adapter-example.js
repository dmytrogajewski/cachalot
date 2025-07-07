const { Cache, HazelcastStorageAdapter } = require('../dist');

async function hazelcastExample() {
  // Create Hazelcast adapter with configuration
  const hazelcastAdapter = new HazelcastStorageAdapter({
    clientConfig: {
      network: {
        clusterMembers: ['localhost:5701']
      },
      clusterName: 'dev'
    },
    mapName: 'my_cache',
    logger: console
  });

  // Initialize the adapter
  await hazelcastAdapter.initialize();

  // Create cache with Hazelcast adapter
  const cache = new Cache({
    storageAdapter: hazelcastAdapter,
    defaultTTL: 300000, // 5 minutes
    logger: console
  });

  try {
    // Set a value
    await cache.set('user:123', JSON.stringify({
      id: 123,
      name: 'John Doe',
      email: 'john@example.com'
    }), 600000); // 10 minutes TTL

    // Get the value
    const user = await cache.get('user:123');
    console.log('Retrieved user:', user);

    // Set multiple values
    const users = new Map([
      ['user:456', JSON.stringify({ id: 456, name: 'Jane Smith' })],
      ['user:789', JSON.stringify({ id: 789, name: 'Bob Johnson' })]
    ]);
    await cache.mset(users);

    // Get multiple values
    const retrievedUsers = await cache.mget(['user:456', 'user:789']);
    console.log('Retrieved users:', retrievedUsers);

    // Delete a value
    const deleted = await cache.del('user:123');
    console.log('Deleted user:123:', deleted);

    // Use locking
    const lockAcquired = await cache.acquireLock('critical-resource');
    if (lockAcquired) {
      console.log('Lock acquired for critical-resource');
      
      // Do some work...
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Release the lock
      await cache.releaseLock('critical-resource');
      console.log('Lock released for critical-resource');
    } else {
      console.log('Failed to acquire lock for critical-resource');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    await cache.close();
  }
}

// Run the example
hazelcastExample().catch(console.error); 