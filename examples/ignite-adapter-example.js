const { Cache, IgniteStorageAdapter } = require('../dist');

async function igniteExample() {
  // Create Ignite adapter with configuration
  const igniteAdapter = new IgniteStorageAdapter({
    endpoint: 'localhost:10800',
    username: 'ignite_user',
    password: 'ignite_password',
    cacheName: 'my_cache',
    logger: console
  });

  // Initialize the adapter
  await igniteAdapter.initialize();

  // Create cache with Ignite adapter
  const cache = new Cache({
    storageAdapter: igniteAdapter,
    defaultTTL: 300000, // 5 minutes
    logger: console
  });

  try {
    // Set a value
    await cache.set('product:123', JSON.stringify({
      id: 123,
      name: 'Laptop',
      price: 999.99,
      category: 'Electronics'
    }), 900000); // 15 minutes TTL

    // Get the value
    const product = await cache.get('product:123');
    console.log('Retrieved product:', product);

    // Set multiple values
    const products = new Map([
      ['product:456', JSON.stringify({ id: 456, name: 'Mouse', price: 29.99 })],
      ['product:789', JSON.stringify({ id: 789, name: 'Keyboard', price: 89.99 })]
    ]);
    await cache.mset(products);

    // Get multiple values
    const retrievedProducts = await cache.mget(['product:456', 'product:789']);
    console.log('Retrieved products:', retrievedProducts);

    // Delete a value
    const deleted = await cache.del('product:123');
    console.log('Deleted product:123:', deleted);

    // Use locking for inventory management
    const lockAcquired = await cache.acquireLock('inventory:laptop');
    if (lockAcquired) {
      console.log('Lock acquired for inventory:laptop');
      
      // Simulate inventory update
      const currentInventory = await cache.get('inventory:laptop') || '0';
      const newInventory = parseInt(currentInventory) + 1;
      await cache.set('inventory:laptop', newInventory.toString(), 3600000); // 1 hour
      
      console.log(`Updated inventory: ${newInventory} laptops`);
      
      // Release the lock
      await cache.releaseLock('inventory:laptop');
      console.log('Lock released for inventory:laptop');
    } else {
      console.log('Failed to acquire lock for inventory:laptop');
    }

    // Check if lock exists
    const lockExists = await cache.isLockExists('inventory:laptop');
    console.log('Lock exists for inventory:laptop:', lockExists);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    await cache.close();
  }
}

// Run the example
igniteExample().catch(console.error); 