# <img src="assets/logo.svg" alt="cachalot logo" height="100px">

[![Build status](https://img.shields.io/github/workflow/status/Tinkoff/cachalot/CI?style=flat-square)](https://github.com/Tinkoff/cachalot/actions?query=branch%3Amaster+workflow%3ACI)
[![Coveralls github](https://img.shields.io/coveralls/github/Tinkoff/cachalot.svg?style=flat-square)](https://coveralls.io/github/Tinkoff/cachalot)
[![Written in typescript](https://img.shields.io/badge/written_in-typescript-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/cachalot.svg?style=flat-square)](https://www.npmjs.com/package/cachalot)

Zero-dependency library designed to cache query results with advanced caching strategies and multi-level support.

## Features

* **Multiple Caching Strategies**: Read-Through, Write-Through, Refresh-Ahead, Multi-Level
* **Bloom Filter Support**: Reduce cache misses with probabilistic data structures
* **Flexible Storage**: Adapters for Redis, Memcached, and custom storage
* **Key Management**: Prefixes, automatic hashing, and tag-based invalidation
* **Comprehensive Logging**: Built-in logging support for monitoring and debugging
* **Locked Key Strategies**: Configurable behavior for concurrent access
* **Metrics Support**: Track performance and usage patterns

## Table of Contents

- [Getting Started](#getting-started)
- [Caching Strategies](#caching-strategies)
  - [Read-Through](#read-through)
  - [Write-Through](#write-through)
  - [Refresh-Ahead](#refresh-ahead)
  - [Multi-Level](#multi-level)
- [Advanced Features](#advanced-features)
  - [Bloom Filters](#bloom-filters)
  - [Metrics](#metrics)
  - [Locked Key Strategies](#locked-key-strategies)
- [Storage Adapters](#storage-adapters)
- [API Reference](#api-reference)
- [Real-World Integrations](#real-world-integrations)

## Getting Started

### Basic Setup

```typescript
import Redis from 'ioredis';
import Cache, { RedisStorageAdapter } from 'cachalot';
import logger from './logger';

const redis = new Redis();

export const cache = new Cache({
  adapter: new RedisStorageAdapter(redis),
  logger,
  expiresIn: 3600000, // 1 hour default TTL
  prefix: 'myapp',    // Optional key prefix
});
```

### Logger Interface

Your logger must implement this interface:

```typescript
interface Logger {
  info(...args: any[]): void;
  trace(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}
```

### Basic Usage

```typescript
// Simple cache get with executor
const user = await cache.get('user:123', async () => {
  return await fetchUserFromDatabase(123);
});

// With tags for invalidation
const user = await cache.get('user:123', async () => {
  return await fetchUserFromDatabase(123);
}, {
  tags: ['user:123', 'users'],
  expiresIn: 1800000, // 30 minutes
});

// Invalidate by tag
await cache.touch(['users']); // Invalidates all user records
```

## Caching Strategies

### Read-Through

**Best for**: Read-heavy applications, when you want automatic cache population on misses.

Read-Through automatically loads data from the data source when it's not in cache.

```typescript
import { ReadThroughManager } from 'cachalot';

// Register the manager
cache.registerManager(ReadThroughManager);

// Use it
const user = await cache.get('user:123', async () => {
  return await fetchUserFromDatabase(123);
}, {
  manager: 'read-through',
  tags: ['user:123', 'users']
});
```

**Use Cases**:
- User profiles and preferences
- Product catalogs
- Configuration data
- Frequently accessed reference data

### Write-Through

**Best for**: Write-heavy applications requiring strong consistency.

Write-Through ensures data is written to both cache and data source simultaneously.

```typescript
import { WriteThroughManager } from 'cachalot';

cache.registerManager(WriteThroughManager);

// Write data (creates permanent cache entry)
await cache.set('user:123', userData, {
  manager: 'write-through',
  tags: ['user:123', 'users']
});

// Read (no validation, returns what's in cache)
const user = await cache.get('user:123', async () => {
  return await fetchUserFromDatabase(123);
}, {
  manager: 'write-through'
});
```

**Use Cases**:
- User registration/updates
- Order processing
- Financial transactions
- Any write-heavy workload

### Refresh-Ahead

**Best for**: High-traffic applications where you want to avoid cache expiration spikes.

Refresh-Ahead proactively refreshes cache entries before they expire.

```typescript
import { RefreshAheadManager } from 'cachalot';

// Register with custom refresh factor (0.8 = refresh when 80% of TTL remains)
cache.registerManager(RefreshAheadManager, null, {
  refreshAheadFactor: 0.8,
});

// Use it
const user = await cache.get('user:123', async () => {
  return await fetchUserFromDatabase(123);
}, {
  manager: 'refresh-ahead',
  tags: ['user:123', 'users']
});
```

**Use Cases**:
- High-traffic websites
- API endpoints with predictable access patterns
- Real-time dashboards
- Content delivery networks

### Multi-Level

**Best for**: Performance-critical applications requiring multiple cache tiers.

Multi-Level supports multiple cache levels (e.g., L1: Memory, L2: Redis, L3: Database).

```typescript
import { MultiLevelManager } from 'cachalot';
import { RedisStorageAdapter } from 'cachalot';

// Create different storage adapters
const memoryStorage = new InMemoryStorageAdapter();
const redisStorage = new RedisStorageAdapter(redis);

// Configure multi-level cache
const multiLevelManager = new MultiLevelManager({
  levels: [
    {
      name: 'L1-Memory',
      storage: memoryStorage,
      priority: 1, // Checked first
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

// Register the manager
cache.registerManager(multiLevelManager, 'multi-level');

// Use it
const user = await cache.get('user:123', async () => {
  return await fetchUserFromDatabase(123);
}, {
  manager: 'multi-level',
  tags: ['user:123', 'users']
});

// Get metrics
const metrics = multiLevelManager.getMetrics();
console.log('Cache hits by level:', metrics);
```

**Use Cases**:
- High-performance applications
- Microservices with shared caching
- Applications with mixed access patterns
- Systems requiring both speed and persistence

## Advanced Features

### Bloom Filters

Bloom filters can significantly reduce cache misses by providing fast negative lookups.

```typescript
// Enable Bloom filter globally
const cache = new Cache({
  adapter: new RedisStorageAdapter(redis),
  logger,
  enableBloomFilter: true,
  bloomFilterOptions: {
    expectedElements: 10000,  // Expected number of unique keys
    falsePositiveRate: 0.01,  // 1% false positive rate
  },
});

// Or enable per-manager
cache.registerManager(ReadThroughManager, null, {
  enableBloomFilter: true,
  bloomFilterOptions: {
    expectedElements: 5000,
    falsePositiveRate: 0.05,
  },
});
```

**Benefits**:
- Reduces unnecessary storage calls
- Improves performance for cache misses
- Minimal memory overhead
- Configurable accuracy vs. memory trade-off

### Metrics

Track cache performance and usage patterns.

```typescript
// Get metrics from Multi-Level Manager
const metrics = multiLevelManager.getMetrics();
console.log(metrics);
// Output:
// {
//   "L1-Memory": { hits: 150, misses: 10, sets: 160, dels: 5 },
//   "L2-Redis": { hits: 45, misses: 25, sets: 70, dels: 3 }
// }

// Get level statistics
const stats = multiLevelManager.getLevelStats();
console.log(stats);
// Output:
// [
//   { name: "L1-Memory", enabled: true, priority: 1 },
//   { name: "L2-Redis", enabled: true, priority: 2 }
// ]
```

### Locked Key Strategies

Configure behavior when cache entries are locked for updates.

```typescript
// Wait for result (good for heavy queries)
const user = await cache.get('user:123', async () => {
  return await heavyDatabaseQuery(123);
}, {
  lockedKeyRetrieveStrategy: 'waitForResult',
  tags: ['user:123']
});

// Run executor immediately (good for light queries)
const user = await cache.get('user:123', async () => {
  return await lightDatabaseQuery(123);
}, {
  lockedKeyRetrieveStrategy: 'runExecutor',
  tags: ['user:123']
});
```

## Storage Adapters

### Redis Adapter

```typescript
import { RedisStorageAdapter } from 'cachalot';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

const cache = new Cache({
  adapter: new RedisStorageAdapter(redis),
  logger,
});
```

### Memcached Adapter

```typescript
import { MemcachedStorageAdapter } from 'cachalot';
import Memcached from 'memcached';

const memcached = new Memcached('localhost:11211');

const cache = new Cache({
  adapter: new MemcachedStorageAdapter(memcached),
  logger,
});
```

### Custom Storage Adapter

```typescript
import { StorageAdapter } from 'cachalot';

class CustomStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    // Your implementation
  }
  
  async set(key: string, value: string, options?: any): Promise<void> {
    // Your implementation
  }
  
  async del(key: string): Promise<boolean> {
    // Your implementation
  }
  
  // ... other required methods
}

const cache = new Cache({
  adapter: new CustomStorageAdapter(),
  logger,
});
```

## API Reference

### Cache Options

```typescript
interface CacheOptions {
  adapter: StorageAdapter;
  tagsAdapter?: StorageAdapter;
  logger: Logger;
  expiresIn?: number;
  prefix?: string;
  hashKeys?: boolean;
  enableBloomFilter?: boolean;
  bloomFilterOptions?: {
    expectedElements?: number;
    falsePositiveRate?: number;
  };
}
```

### Get Options

```typescript
interface GetOptions {
  expiresIn?: number;
  tags?: string[] | (() => string[]);
  manager?: string;
  lockedKeyRetrieveStrategy?: 'waitForResult' | 'runExecutor';
}
```

### Set Options

```typescript
interface SetOptions {
  expiresIn?: number;
  tags?: string[] | (() => string[]);
  manager?: string;
  permanent?: boolean;
}
```

## Best Practices

### 1. Choose the Right Strategy

- **Read-Through**: For read-heavy workloads
- **Write-Through**: For write-heavy workloads requiring consistency
- **Refresh-Ahead**: For high-traffic applications
- **Multi-Level**: For performance-critical applications

### 2. Configure Bloom Filters

- Use for applications with many cache misses
- Set `expectedElements` based on your key space
- Balance `falsePositiveRate` vs. memory usage

### 3. Monitor Performance

- Use metrics to track cache hit rates
- Monitor Bloom filter effectiveness
- Set appropriate TTLs per data type

### 4. Handle Errors Gracefully

```typescript
try {
  const data = await cache.get('key', async () => {
    return await fetchData();
  });
} catch (error) {
  // Handle cache errors gracefully
  console.error('Cache error:', error);
  // Fallback to direct data source
  return await fetchData();
}
```

### 5. Use Tags for Invalidation

```typescript
// Cache user data with tags
await cache.get('user:123', fetchUser, {
  tags: ['user:123', 'users', 'premium-users']
});

// Invalidate specific user
await cache.touch(['user:123']);

// Invalidate all users
await cache.touch(['users']);

// Invalidate premium users
await cache.touch(['premium-users']);
```

## Real-World Integrations

For comprehensive real-world integration examples with popular libraries and frameworks, see [Real-World Integrations Guide](docs/REAL_WORLD_INTEGRATIONS.md).

## Examples

### E-commerce Application

```typescript
// Product catalog with multi-level caching
const productCache = new Cache({
  adapter: new RedisStorageAdapter(redis),
  logger,
  enableBloomFilter: true,
});

// Register multi-level manager
const multiLevelManager = new MultiLevelManager({
  levels: [
    { name: 'L1-Memory', storage: memoryStorage, priority: 1, ttl: 300000, enabled: true },
    { name: 'L2-Redis', storage: redisStorage, priority: 2, ttl: 3600000, enabled: true },
  ],
  logger,
  storage: memoryStorage,
  enableBloomFilter: true,
});

productCache.registerManager(multiLevelManager, 'product-cache');

// Cache product data
const product = await productCache.get(`product:${id}`, async () => {
  return await fetchProductFromDatabase(id);
}, {
  manager: 'product-cache',
  tags: [`product:${id}`, 'products', category],
});

// Invalidate when product is updated
await productCache.touch([`product:${id}`, category]);
```

### User Session Management

```typescript
// User sessions with write-through
const sessionCache = new Cache({
  adapter: new RedisStorageAdapter(redis),
  logger,
});

sessionCache.registerManager(WriteThroughManager);

// Store session data
await sessionCache.set(`session:${sessionId}`, sessionData, {
  manager: 'write-through',
  tags: [`session:${sessionId}`, 'sessions', `user:${userId}`],
  permanent: true,
});

// Retrieve session
const session = await sessionCache.get(`session:${sessionId}`, async () => {
  return await fetchSessionFromDatabase(sessionId);
}, {
  manager: 'write-through',
});

// Invalidate user sessions
await sessionCache.touch([`user:${userId}`]);
```

### API Rate Limiting

```typescript
// Rate limiting with refresh-ahead
const rateLimitCache = new Cache({
  adapter: new RedisStorageAdapter(redis),
  logger,
});

rateLimitCache.registerManager(RefreshAheadManager, null, {
  refreshAheadFactor: 0.9,
});

// Track API calls
const rateLimit = await rateLimitCache.get(`rate:${userId}`, async () => {
  return { calls: 0, resetTime: Date.now() + 3600000 };
}, {
  manager: 'refresh-ahead',
  expiresIn: 3600000, // 1 hour
  tags: [`rate:${userId}`],
});

if (rateLimit.calls >= 1000) {
  throw new Error('Rate limit exceeded');
}

// Update call count
await rateLimitCache.set(`rate:${userId}`, {
  ...rateLimit,
  calls: rateLimit.calls + 1,
}, {
  manager: 'refresh-ahead',
  tags: [`rate:${userId}`],
});
```
