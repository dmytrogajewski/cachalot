# Multi-Level Caching Guide

The MultiLevelManager provides a powerful way to implement tiered caching strategies, combining multiple storage layers for optimal performance.

## Overview

Multi-level caching typically consists of:
- **L1 (Level 1)**: Fast, local memory cache (e.g., in-memory)
- **L2 (Level 2)**: Distributed cache (e.g., Redis)
- **L3 (Level 3)**: Persistent storage (e.g., Database)

## Basic Setup

```typescript
import { MultiLevelManager } from 'cachalot';
import { RedisStorageAdapter } from 'cachalot';

// Create storage adapters for different levels
const memoryStorage = new InMemoryStorageAdapter();
const redisStorage = new RedisStorageAdapter(redis);

// Configure multi-level cache
const multiLevelManager = new MultiLevelManager({
  levels: [
    {
      name: 'L1-Memory',
      storage: memoryStorage,
      priority: 1, // Checked first (highest priority)
      ttl: 60000,  // 1 minute
      enabled: true,
    },
    {
      name: 'L2-Redis',
      storage: redisStorage,
      priority: 2, // Checked second
      ttl: 3600000, // 1 hour
      enabled: true,
    },
  ],
  logger,
  storage: memoryStorage, // Fallback storage
  fallbackStrategy: 'executor', // 'executor' | 'next-level' | 'fail'
  enableBloomFilter: true,
  bloomFilterOptions: {
    expectedElements: 10000,
    falsePositiveRate: 0.01,
  },
});

// Register with cache
cache.registerManager(multiLevelManager, 'multi-level');
```

## Configuration Options

### Level Configuration

```typescript
interface CacheLevel {
  name: string;           // Unique identifier for the level
  storage: Storage;       // Storage adapter for this level
  priority: number;       // Lower number = higher priority (checked first)
  ttl?: number;          // Optional TTL override for this level
  enabled: boolean;      // Whether this level is active
}
```

### Fallback Strategies

```typescript
type FallbackStrategy = 'executor' | 'next-level' | 'fail';

// executor: Run the executor function when all levels miss
// next-level: Try to get from next level (future enhancement)
// fail: Throw an error when all levels miss
```

## Usage Examples

### Basic Multi-Level Cache

```typescript
// Get data with automatic level checking
const user = await cache.get('user:123', async () => {
  return await fetchUserFromDatabase(123);
}, {
  manager: 'multi-level',
  tags: ['user:123', 'users']
});

// The manager will:
// 1. Check L1-Memory first
// 2. If miss, check L2-Redis
// 3. If miss, run executor and populate all levels
```

### Dynamic Level Management

```typescript
// Enable/disable levels at runtime
multiLevelManager.disableLevel('L1-Memory');
multiLevelManager.enableLevel('L2-Redis');

// Get level statistics
const stats = multiLevelManager.getLevelStats();
console.log(stats);
// [
//   { name: "L1-Memory", enabled: false, priority: 1 },
//   { name: "L2-Redis", enabled: true, priority: 2 }
// ]
```

### Performance Monitoring

```typescript
// Get detailed metrics
const metrics = multiLevelManager.getMetrics();
console.log(metrics);
// {
//   "L1-Memory": { hits: 150, misses: 10, sets: 160, dels: 5 },
//   "L2-Redis": { hits: 45, misses: 25, sets: 70, dels: 3 }
// }

// Calculate hit rates
const l1HitRate = metrics['L1-Memory'].hits / (metrics['L1-Memory'].hits + metrics['L1-Memory'].misses);
const l2HitRate = metrics['L2-Redis'].hits / (metrics['L2-Redis'].hits + metrics['L2-Redis'].misses);
```

## Advanced Configurations

### Three-Level Cache

```typescript
const threeLevelManager = new MultiLevelManager({
  levels: [
    {
      name: 'L1-Memory',
      storage: memoryStorage,
      priority: 1,
      ttl: 30000, // 30 seconds
      enabled: true,
    },
    {
      name: 'L2-Redis',
      storage: redisStorage,
      priority: 2,
      ttl: 1800000, // 30 minutes
      enabled: true,
    },
    {
      name: 'L3-Database',
      storage: databaseStorage,
      priority: 3,
      ttl: 86400000, // 24 hours
      enabled: true,
    },
  ],
  logger,
  storage: memoryStorage,
  fallbackStrategy: 'executor',
});
```

### Conditional Level Usage

```typescript
// Disable Redis during maintenance
if (isRedisMaintenanceMode) {
  multiLevelManager.disableLevel('L2-Redis');
}

// Re-enable when maintenance is complete
if (!isRedisMaintenanceMode) {
  multiLevelManager.enableLevel('L2-Redis');
}
```

### Custom Storage Adapters

```typescript
class CustomStorageAdapter implements Storage {
  async get(key: string): Promise<string | null> {
    // Your custom implementation
  }
  
  async set(key: string, value: string, options?: any): Promise<void> {
    // Your custom implementation
  }
  
  // ... other required methods
}

const customLevel = {
  name: 'L2-Custom',
  storage: new CustomStorageAdapter(),
  priority: 2,
  ttl: 3600000,
  enabled: true,
};
```

## Use Cases

### E-commerce Product Catalog

```typescript
const productCache = new MultiLevelManager({
  levels: [
    {
      name: 'L1-Memory',
      storage: memoryStorage,
      priority: 1,
      ttl: 300000, // 5 minutes for hot products
      enabled: true,
    },
    {
      name: 'L2-Redis',
      storage: redisStorage,
      priority: 2,
      ttl: 3600000, // 1 hour for all products
      enabled: true,
    },
  ],
  logger,
  storage: memoryStorage,
  enableBloomFilter: true,
});

// Cache product data
const product = await cache.get(`product:${id}`, async () => {
  return await fetchProductFromDatabase(id);
}, {
  manager: 'multi-level',
  tags: [`product:${id}`, 'products', category],
});
```

### User Session Management

```typescript
const sessionCache = new MultiLevelManager({
  levels: [
    {
      name: 'L1-Memory',
      storage: memoryStorage,
      priority: 1,
      ttl: 600000, // 10 minutes
      enabled: true,
    },
    {
      name: 'L2-Redis',
      storage: redisStorage,
      priority: 2,
      ttl: 3600000, // 1 hour
      enabled: true,
    },
  ],
  logger,
  storage: memoryStorage,
});

// Store session
await sessionCache.set(`session:${sessionId}`, sessionData, {
  tags: [`session:${sessionId}`, 'sessions', `user:${userId}`],
});

// Retrieve session
const session = await sessionCache.get(`session:${sessionId}`, async () => {
  return await fetchSessionFromDatabase(sessionId);
});
```

### API Response Caching

```typescript
const apiCache = new MultiLevelManager({
  levels: [
    {
      name: 'L1-Memory',
      storage: memoryStorage,
      priority: 1,
      ttl: 60000, // 1 minute for API responses
      enabled: true,
    },
    {
      name: 'L2-Redis',
      storage: redisStorage,
      priority: 2,
      ttl: 300000, // 5 minutes
      enabled: true,
    },
  ],
  logger,
  storage: memoryStorage,
  enableBloomFilter: true,
});

// Cache API responses
const apiResponse = await cache.get(`api:${endpoint}:${params}`, async () => {
  return await fetchFromExternalAPI(endpoint, params);
}, {
  manager: 'multi-level',
  tags: [`api:${endpoint}`, 'api-responses'],
});
```

## Performance Optimization

### Bloom Filter Configuration

```typescript
// For high-traffic applications
const highTrafficConfig = {
  expectedElements: 100000,
  falsePositiveRate: 0.01, // 1% false positive rate
};

// For memory-constrained environments
const memoryOptimizedConfig = {
  expectedElements: 10000,
  falsePositiveRate: 0.05, // 5% false positive rate
};
```

### TTL Optimization

```typescript
// Hot data (frequently accessed)
const hotDataTTL = 60000; // 1 minute

// Warm data (moderately accessed)
const warmDataTTL = 3600000; // 1 hour

// Cold data (rarely accessed)
const coldDataTTL = 86400000; // 24 hours
```

### Level Priority Optimization

```typescript
// For read-heavy workloads
const readOptimizedLevels = [
  { name: 'L1-Memory', priority: 1, ttl: 300000 },
  { name: 'L2-Redis', priority: 2, ttl: 3600000 },
];

// For write-heavy workloads
const writeOptimizedLevels = [
  { name: 'L1-Memory', priority: 1, ttl: 60000 },
  { name: 'L2-Redis', priority: 2, ttl: 1800000 },
];
```

## Monitoring and Debugging

### Metrics Collection

```typescript
// Collect metrics periodically
setInterval(() => {
  const metrics = multiLevelManager.getMetrics();
  
  // Send to monitoring system
  monitoringSystem.record('cache.hits.l1', metrics['L1-Memory'].hits);
  monitoringSystem.record('cache.hits.l2', metrics['L2-Redis'].hits);
  monitoringSystem.record('cache.misses.l1', metrics['L1-Memory'].misses);
  monitoringSystem.record('cache.misses.l2', metrics['L2-Redis'].misses);
  
  // Calculate hit rates
  const l1HitRate = metrics['L1-Memory'].hits / (metrics['L1-Memory'].hits + metrics['L1-Memory'].misses);
  const l2HitRate = metrics['L2-Redis'].hits / (metrics['L2-Redis'].hits + metrics['L2-Redis'].misses);
  
  monitoringSystem.record('cache.hit_rate.l1', l1HitRate);
  monitoringSystem.record('cache.hit_rate.l2', l2HitRate);
}, 60000); // Every minute
```

### Error Handling

```typescript
try {
  const data = await cache.get('key', async () => {
    return await fetchData();
  }, {
    manager: 'multi-level',
  });
} catch (error) {
  if (error.message.includes('Cache miss')) {
    // Handle cache miss gracefully
    console.warn('Cache miss for key:', error);
  } else {
    // Handle other errors
    console.error('Cache error:', error);
  }
  
  // Fallback to direct data source
  return await fetchData();
}
```

### Debug Logging

```typescript
const debugLogger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  trace: (msg: string) => console.log(`[TRACE] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

const debugManager = new MultiLevelManager({
  levels: [...],
  logger: debugLogger,
  // ... other options
});
```

## Best Practices

1. **Start Simple**: Begin with 2 levels (L1: Memory, L2: Redis)
2. **Monitor Performance**: Use metrics to optimize TTLs and priorities
3. **Handle Failures**: Implement graceful fallbacks for level failures
4. **Use Bloom Filters**: Enable for applications with many cache misses
5. **Optimize TTLs**: Set appropriate TTLs based on data access patterns
6. **Test Thoroughly**: Test with realistic load patterns
7. **Monitor Memory**: Keep track of memory usage for in-memory levels 