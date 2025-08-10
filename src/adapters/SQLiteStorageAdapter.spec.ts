import { SQLiteStorageAdapter } from './SQLiteStorageAdapter';
import { Logger } from '../Logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SQLiteStorageAdapter', () => {
  let adapter: SQLiteStorageAdapter;
  let tempDir: string;
  let dbPath: string;
  let logger: Logger;

  beforeEach(async () => {
    // Create temporary directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-test-'));
    dbPath = path.join(tempDir, 'test.db');
    
    logger = console;
    adapter = new SQLiteStorageAdapter({
      databasePath: dbPath,
      tableName: 'test_cache',
      logger
    });

    await adapter.initialize();
  });

  afterEach(async () => {
    try {
      await adapter.close();
    } catch (error) {
      // Ignore close errors
    }
    
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmdirSync(tempDir);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Basic CRUD Operations', () => {
    it('should set and get a simple value', async () => {
      const key = 'test-key';
      const value = 'test-value';

      const setResult = await adapter.set(key, value);
      expect(setResult).toBe(true);

      const result = await adapter.get(key);
      expect(result).toBe(value);
    });

    it('should return null for non-existent key', async () => {
      const result = await adapter.get('non-existent');
      expect(result).toBeNull();
    });

    it('should update existing value', async () => {
      const key = 'update-test';
      const value1 = 'first';
      const value2 = 'second';

      await adapter.set(key, value1);
      await adapter.set(key, value2);

      const result = await adapter.get(key);
      expect(result).toBe(value2);
    });

    it('should delete existing key', async () => {
      const key = 'delete-test';
      const value = 'to-delete';

      await adapter.set(key, value);
      expect(await adapter.get(key)).toBe(value);

      const deleteResult = await adapter.del(key);
      expect(deleteResult).toBe(true);
      expect(await adapter.get(key)).toBeNull();
    });

    it('should set multiple values', async () => {
      const values = new Map<string, string>([
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3']
      ]);

      await adapter.mset(values);

      const results = await adapter.mget(['key1', 'key2', 'key3']);
      expect(results).toEqual(['value1', 'value2', 'value3']);
    });

    it('should get multiple values', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key2', 'value2');
      await adapter.set('key3', 'value3');

      const results = await adapter.mget(['key1', 'key2', 'key3', 'non-existent']);
      expect(results).toEqual(['value1', 'value2', 'value3', null]);
    });
  });

  describe('TTL Support', () => {
    it('should set item with TTL', async () => {
      const key = 'ttl-test';
      const value = 'ttl-value';
      const ttl = 100; // 100ms

      const setResult = await adapter.set(key, value, ttl);
      expect(setResult).toBe(true);

      const result = await adapter.get(key);
      expect(result).toBe(value);
    });

    it('should expire items after TTL', async () => {
      const key = 'expire-test';
      const value = 'expire-value';
      const ttl = 50; // 50ms

      await adapter.set(key, value, ttl);
      expect(await adapter.get(key)).toBe(value);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(await adapter.get(key)).toBeNull();
    });

    it('should not expire items without TTL', async () => {
      const key = 'no-ttl-test';
      const value = 'no-ttl-value';

      await adapter.set(key, value);
      const result = await adapter.get(key);
      expect(result).toBe(value);
    });
  });

  describe('Locking Operations', () => {
    it('should acquire and release lock', async () => {
      const key = 'lock-test';
      const ttl = 1000;

      // Set a value first
      await adapter.set(key, 'lock-value');

      // Acquire lock
      const acquired = await adapter.acquireLock(key, ttl);
      expect(acquired).toBe(true);

      // Check if lock exists
      const lockExists = await adapter.isLockExists(key);
      expect(lockExists).toBe(true);

      // Release lock
      const released = await adapter.releaseLock(key);
      expect(released).toBe(true);

      // Verify lock is released
      const lockExistsAfter = await adapter.isLockExists(key);
      expect(lockExistsAfter).toBe(false);
    });

    it('should not acquire lock if already locked', async () => {
      const key = 'lock-conflict-test';
      const ttl = 1000;

      await adapter.set(key, 'test');

      // First lock acquisition
      const acquired1 = await adapter.acquireLock(key, ttl);
      expect(acquired1).toBe(true);

      // Second lock acquisition should fail
      const acquired2 = await adapter.acquireLock(key, ttl);
      expect(acquired2).toBe(false);

      // Verify first lock still exists
      const lockExists = await adapter.isLockExists(key);
      expect(lockExists).toBe(true);
    });

    it('should expire locks after TTL', async () => {
      const key = 'lock-expire-test';
      const ttl = 50; // 50ms

      await adapter.set(key, 'test');

      // Acquire lock
      await adapter.acquireLock(key, ttl);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // Lock should be expired
      const lockExists = await adapter.isLockExists(key);
      expect(lockExists).toBe(false);
    });

    it('should allow acquiring lock after expiration', async () => {
      const key = 'lock-expire-acquire-test';
      const ttl = 50; // 50ms

      await adapter.set(key, 'test');

      // First lock acquisition
      await adapter.acquireLock(key, ttl);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should be able to acquire lock now
      const acquired = await adapter.acquireLock(key, ttl);
      expect(acquired).toBe(true);

      const lockExists = await adapter.isLockExists(key);
      expect(lockExists).toBe(true);
    });
  });

  describe('Connection Status', () => {
    it('should return correct connection status', async () => {
      expect(adapter.getConnectionStatus()).toBe('connected');
    });

    it('should call onConnect callback', async () => {
      const callback = jest.fn();
      adapter.onConnect(callback);
      
      // Wait a bit for the callback to be called
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('Cleanup Operations', () => {
    it('should cleanup expired items', async () => {
      // Set items with different TTLs
      await adapter.set('expired1', 'expired1', 50);
      await adapter.set('expired2', 'expired2', 50);
      await adapter.set('valid1', 'valid1');
      await adapter.set('valid2', 'valid2');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // Run cleanup
      await adapter.cleanup();

      // Check results
      expect(await adapter.get('valid1')).toBe('valid1');
      expect(await adapter.get('valid2')).toBe('valid2');
      expect(await adapter.get('expired1')).toBeNull();
      expect(await adapter.get('expired2')).toBeNull();
    });

    it('should cleanup expired locks', async () => {
      const key = 'cleanup-lock-test';
      const ttl = 50; // 50ms

      await adapter.set(key, 'test');
      await adapter.acquireLock(key, ttl);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // Run cleanup
      await adapter.cleanup();

      // Lock should be cleaned up
      const lockExists = await adapter.isLockExists(key);
      expect(lockExists).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Create adapter with invalid path
      const invalidAdapter = new SQLiteStorageAdapter({
        databasePath: '/invalid/path/test.db',
        logger
      });

      await expect(invalidAdapter.initialize()).rejects.toThrow();
    });

    it('should handle JSON parsing errors', async () => {
      const key = 'json-test';
      const value = '{"complex": {"nested": {"data": "test"}}}';

      await adapter.set(key, value);
      const result = await adapter.get(key);

      expect(result).toBe(value);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent set operations', async () => {
      const promises: Promise<boolean>[] = [];
      const numOperations = 10;

      for (let i = 0; i < numOperations; i++) {
        promises.push(adapter.set(`concurrent-${i}`, `value-${i}`));
      }

      const results = await Promise.all(promises);
      expect(results.every((result: boolean) => result === true)).toBe(true);

      for (let i = 0; i < numOperations; i++) {
        expect(await adapter.get(`concurrent-${i}`)).toBe(`value-${i}`);
      }
    });

    it('should handle concurrent get operations', async () => {
      const key = 'concurrent-get-test';
      const value = 'concurrent-value';

      await adapter.set(key, value);

      const promises: Promise<string | null>[] = [];
      const numOperations = 10;

      for (let i = 0; i < numOperations; i++) {
        promises.push(adapter.get(key));
      }

      const results = await Promise.all(promises);

      for (const result of results) {
        expect(result).toBe(value);
      }
    });
  });
}); 