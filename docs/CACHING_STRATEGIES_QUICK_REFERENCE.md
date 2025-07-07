# Caching Strategies Quick Reference

This guide provides a quick comparison of all available caching strategies in Cachalot.

## Strategy Comparison

| Strategy | Best For | Pros | Cons | Use Cases |
|----------|----------|------|------|-----------|
| **Read-Through** | Read-heavy apps | Automatic cache population, simple setup | No write optimization | User profiles, product catalogs, config data |
| **Write-Through** | Write-heavy apps | Strong consistency, immediate updates | Slower writes, no read optimization | User registration, orders, financial data |
| **Refresh-Ahead** | High-traffic apps | Prevents expiration spikes, smooth performance | More complex setup, potential stale data | APIs, dashboards, CDNs |
| **Multi-Level** | Performance-critical apps | Optimal performance, flexible tiers | Complex configuration, more resources | Microservices, high-performance apps |

## Quick Setup Examples

### Read-Through
```typescript
import { ReadThroughManager } from 'cachalot';

cache.registerManager(ReadThroughManager);

const data = await cache.get('key', fetchData, {
  manager: 'read-through',
  tags: ['key', 'category']
});
```

### Write-Through
```typescript
import { WriteThroughManager } from 'cachalot';

cache.registerManager(WriteThroughManager);

await cache.set('key', data, {
  manager: 'write-through',
  tags: ['key', 'category']
});
```

### Refresh-Ahead
```typescript
import { RefreshAheadManager } from 'cachalot';

cache.registerManager(RefreshAheadManager, null, {
  refreshAheadFactor: 0.8, // Refresh at 80% of TTL
});

const data = await cache.get('key', fetchData, {
  manager: 'refresh-ahead',
  tags: ['key', 'category']
});
```

### Multi-Level
```typescript
import { MultiLevelManager } from 'cachalot';

const multiLevelManager = new MultiLevelManager({
  levels: [
    { name: 'L1-Memory', storage: memoryStorage, priority: 1, ttl: 60000, enabled: true },
    { name: 'L2-Redis', storage: redisStorage, priority: 2, ttl: 3600000, enabled: true },
  ],
  logger,
  storage: memoryStorage,
  enableBloomFilter: true,
});

cache.registerManager(multiLevelManager, 'multi-level');

const data = await cache.get('key', fetchData, {
  manager: 'multi-level',
  tags: ['key', 'category']
});
```

## Performance Characteristics

### Latency (Lower is Better)
```
Multi-Level (L1)     < 1ms
Read-Through         ~ 1-5ms
Refresh-Ahead        ~ 1-5ms
Write-Through        ~ 5-10ms
Multi-Level (L2)     ~ 5-10ms
```

### Memory Usage (Lower is Better)
```
Read-Through         Low
Write-Through        Low
Refresh-Ahead        Medium
Multi-Level          High
```

### Complexity (Lower is Better)
```
Read-Through         ★☆☆☆☆
Write-Through        ★☆☆☆☆
Refresh-Ahead        ★★☆☆☆
Multi-Level          ★★★★☆
```

## Configuration Recommendations

### For Different Workloads

#### Read-Heavy (80%+ reads)
```typescript
// Recommended: Read-Through + Refresh-Ahead
cache.registerManager(ReadThroughManager);
cache.registerManager(RefreshAheadManager, null, {
  refreshAheadFactor: 0.7,
});
```

#### Write-Heavy (50%+ writes)
```typescript
// Recommended: Write-Through
cache.registerManager(WriteThroughManager);
```

#### Balanced (50/50 reads/writes)
```typescript
// Recommended: Multi-Level
const multiLevelManager = new MultiLevelManager({
  levels: [
    { name: 'L1-Memory', storage: memoryStorage, priority: 1, ttl: 300000, enabled: true },
    { name: 'L2-Redis', storage: redisStorage, priority: 2, ttl: 1800000, enabled: true },
  ],
  logger,
  storage: memoryStorage,
});
```

#### High-Performance Requirements
```typescript
// Recommended: Multi-Level with Bloom Filter
const multiLevelManager = new MultiLevelManager({
  levels: [
    { name: 'L1-Memory', storage: memoryStorage, priority: 1, ttl: 60000, enabled: true },
    { name: 'L2-Redis', storage: redisStorage, priority: 2, ttl: 3600000, enabled: true },
  ],
  logger,
  storage: memoryStorage,
  enableBloomFilter: true,
  bloomFilterOptions: {
    expectedElements: 10000,
    falsePositiveRate: 0.01,
  },
});
```

## TTL Recommendations

### By Data Type

| Data Type | TTL | Strategy |
|-----------|-----|----------|
| User sessions | 30m-2h | Write-Through |
| Product data | 1h-24h | Read-Through |
| API responses | 5m-30m | Refresh-Ahead |
| Configuration | 1h-24h | Read-Through |
| Analytics | 5m-1h | Multi-Level |

### By Access Pattern

| Pattern | TTL | Strategy |
|---------|-----|----------|
| Hot data (frequent) | 1m-5m | Multi-Level L1 |
| Warm data (moderate) | 30m-2h | Multi-Level L2 |
| Cold data (rare) | 2h-24h | Read-Through |

## Error Handling Patterns

### Graceful Degradation
```typescript
try {
  const data = await cache.get('key', fetchData, {
    manager: 'read-through',
  });
} catch (error) {
  // Fallback to direct data source
  return await fetchData();
}
```

### Circuit Breaker Pattern
```typescript
let cacheFailures = 0;
const MAX_FAILURES = 5;

try {
  const data = await cache.get('key', fetchData, {
    manager: 'read-through',
  });
  cacheFailures = 0; // Reset on success
} catch (error) {
  cacheFailures++;
  if (cacheFailures >= MAX_FAILURES) {
    // Disable cache temporarily
    cache.disableManager('read-through');
  }
  return await fetchData();
}
```

## Monitoring Metrics

### Key Metrics to Track
- **Hit Rate**: `hits / (hits + misses)`
- **Latency**: Average response time
- **Error Rate**: Failed cache operations
- **Memory Usage**: For in-memory levels
- **Bloom Filter Effectiveness**: False positive rate

### Example Monitoring Setup
```typescript
// Collect metrics every minute
setInterval(() => {
  const metrics = multiLevelManager.getMetrics();
  
  // Send to monitoring system
  Object.entries(metrics).forEach(([level, stats]) => {
    const hitRate = stats.hits / (stats.hits + stats.misses);
    monitoringSystem.record(`cache.${level}.hit_rate`, hitRate);
    monitoringSystem.record(`cache.${level}.operations`, stats.hits + stats.misses);
  });
}, 60000);
```

## Migration Guide

### From Single Strategy to Multi-Level

```typescript
// Before: Single strategy
cache.registerManager(ReadThroughManager);

// After: Multi-level with same behavior
const multiLevelManager = new MultiLevelManager({
  levels: [
    { name: 'L1-Memory', storage: memoryStorage, priority: 1, ttl: 60000, enabled: true },
    { name: 'L2-Redis', storage: redisStorage, priority: 2, ttl: 3600000, enabled: true },
  ],
  logger,
  storage: memoryStorage,
  fallbackStrategy: 'executor',
});

cache.registerManager(multiLevelManager, 'multi-level');
```

### Adding Bloom Filter to Existing Setup

```typescript
// Before: No Bloom filter
cache.registerManager(ReadThroughManager);

// After: With Bloom filter
cache.registerManager(ReadThroughManager, null, {
  enableBloomFilter: true,
  bloomFilterOptions: {
    expectedElements: 10000,
    falsePositiveRate: 0.01,
  },
});
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| High latency | Cache misses | Enable Bloom filter, adjust TTL |
| Memory issues | Large cache size | Reduce TTL, use eviction policies |
| Stale data | Long TTL | Reduce TTL, use Refresh-Ahead |
| Cache thrashing | Too many levels | Simplify to 2-3 levels |

### Debug Commands
```typescript
// Check cache status
console.log(cache.getManagerStats());

// Check Bloom filter status
console.log(multiLevelManager.getBloomFilterStats());

// Check level status
console.log(multiLevelManager.getLevelStats());

// Get detailed metrics
console.log(multiLevelManager.getMetrics());
``` 