import { IgniteStorageAdapter } from './IgniteStorageAdapter';
import { ConnectionStatus } from '../ConnectionStatus';
import { Logger } from '../Logger';

// Mock the apache-ignite-client module
jest.mock('apache-ignite-client', () => ({
  IgniteClient: jest.fn()
}), { virtual: true });

describe('IgniteStorageAdapter', () => {
  let adapter: IgniteStorageAdapter;
  let mockClient: any;
  let mockCache: any;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn()
    } as jest.Mocked<Logger>;

    mockCache = {
      put: jest.fn(),
      get: jest.fn(),
      remove: jest.fn(),
      entries: jest.fn()
    };

    mockClient = {
      connect: jest.fn(),
      getOrCreateCache: jest.fn().mockResolvedValue(mockCache),
      getOrCreateLock: jest.fn().mockReturnValue({
        tryLock: jest.fn(),
        unlock: jest.fn()
      }),
      disconnect: jest.fn()
    };

    const { IgniteClient } = require('apache-ignite-client');
    IgniteClient.mockImplementation(() => mockClient);

    adapter = new IgniteStorageAdapter({
      endpoint: 'localhost:10800',
      username: 'testuser',
      password: 'testpass',
      cacheName: 'test_cache',
      logger: mockLogger
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await adapter.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith('Initializing Ignite adapter with cache: test_cache');
      expect(mockLogger.info).toHaveBeenCalledWith('Ignite adapter initialized successfully');
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.CONNECTED);
      expect(mockClient.connect).toHaveBeenCalledWith({
        endpoint: 'localhost:10800',
        username: 'testuser',
        password: 'testpass'
      });
    });

    it('should initialize without credentials', async () => {
      adapter = new IgniteStorageAdapter({
        endpoint: 'localhost:10800',
        cacheName: 'test_cache',
        logger: mockLogger
      });

      await adapter.initialize();

      expect(mockClient.connect).toHaveBeenCalledWith({
        endpoint: 'localhost:10800'
      });
    });

    it('should handle initialization errors', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(adapter.initialize()).rejects.toThrow('Connection failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Ignite adapter', expect.any(Error));
    });
  });

  describe('connection status', () => {
    it('should return correct connection status', () => {
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.DISCONNECTED);
    });

    it('should call onConnect callback when connected', async () => {
      const callback = jest.fn();
      
      adapter.onConnect(callback);
      
      // Should not be called immediately when disconnected
      expect(callback).not.toHaveBeenCalled();
      
      await adapter.initialize();
      
      // Should be called after connection
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('set operations', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should set item successfully', async () => {
      mockCache.put.mockResolvedValue(undefined);

      const result = await adapter.set('test-key', 'test-value');

      expect(result).toBe(true);
      expect(mockCache.put).toHaveBeenCalledWith('test-key', expect.stringContaining('test-value'));
    });

    it('should set item with TTL', async () => {
      mockCache.put.mockResolvedValue(undefined);

      const result = await adapter.set('test-key', 'test-value', 5000);

      expect(result).toBe(true);
      expect(mockCache.put).toHaveBeenCalledWith('test-key', expect.stringContaining('test-value'));
      expect(mockLogger.trace).toHaveBeenCalledWith('Set item with key: test-key, TTL: 5000ms');
    });

    it('should handle set errors', async () => {
      mockCache.put.mockRejectedValue(new Error('Set failed'));

      const result = await adapter.set('test-key', 'test-value');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to set item with key: test-key', expect.any(Error));
    });

    it('should set multiple items', async () => {
      mockCache.put.mockResolvedValue(undefined);

      const values = new Map([
        ['key1', 'value1'],
        ['key2', 'value2']
      ]);

      await adapter.mset(values);

      expect(mockCache.put).toHaveBeenCalledTimes(2);
      expect(mockCache.put).toHaveBeenCalledWith('key1', expect.stringContaining('value1'));
      expect(mockCache.put).toHaveBeenCalledWith('key2', expect.stringContaining('value2'));
      expect(mockLogger.trace).toHaveBeenCalledWith('Set 2 items');
    });

    it('should handle mset errors', async () => {
      mockCache.put.mockRejectedValue(new Error('MSet failed'));

      const values = new Map([['key1', 'value1']]);

      await expect(adapter.mset(values)).rejects.toThrow('MSet failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to set multiple items', expect.any(Error));
    });
  });

  describe('get operations', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should get item successfully', async () => {
      const cacheEntry = {
        value: 'test-value',
        createdAt: Date.now(),
        expiresAt: null
      };
      mockCache.get.mockResolvedValue(JSON.stringify(cacheEntry));

      const result = await adapter.get('test-key');

      expect(result).toBe('test-value');
      expect(mockCache.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null for non-existent item', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await adapter.get('test-key');

      expect(result).toBe(null);
    });

    it('should handle expired items', async () => {
      const cacheEntry = {
        value: 'test-value',
        createdAt: Date.now(),
        expiresAt: Date.now() - 1000 // Expired
      };
      mockCache.get.mockResolvedValue(JSON.stringify(cacheEntry));
      mockCache.remove.mockResolvedValue(true);

      const result = await adapter.get('test-key');

      expect(result).toBe(null);
      expect(mockCache.remove).toHaveBeenCalledWith('test-key');
    });

    it('should handle get errors', async () => {
      mockCache.get.mockRejectedValue(new Error('Get failed'));

      const result = await adapter.get('test-key');

      expect(result).toBe(null);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to get item with key: test-key', expect.any(Error));
    });

    it('should get multiple items', async () => {
      const cacheEntry1 = {
        value: 'value1',
        createdAt: Date.now(),
        expiresAt: null
      };
      const cacheEntry2 = {
        value: 'value2',
        createdAt: Date.now(),
        expiresAt: null
      };

      mockCache.get
        .mockResolvedValueOnce(JSON.stringify(cacheEntry1))
        .mockResolvedValueOnce(JSON.stringify(cacheEntry2));

      const results = await adapter.mget(['key1', 'key2']);

      expect(results).toEqual(['value1', 'value2']);
    });

    it('should handle mget with mixed results', async () => {
      const cacheEntry = {
        value: 'value1',
        createdAt: Date.now(),
        expiresAt: null
      };

      mockCache.get
        .mockResolvedValueOnce(JSON.stringify(cacheEntry))
        .mockResolvedValueOnce(null);

      const results = await adapter.mget(['key1', 'key2']);

      expect(results).toEqual(['value1', null]);
    });

    it('should handle mget errors', async () => {
      mockCache.get.mockRejectedValue(new Error('MGet failed'));

      const results = await adapter.mget(['key1', 'key2']);

      expect(results).toEqual([null, null]);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to get multiple items', expect.any(Error));
    });
  });

  describe('delete operations', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should delete item successfully', async () => {
      mockCache.remove.mockResolvedValue('deleted-value');

      const result = await adapter.del('test-key');

      expect(result).toBe(true);
      expect(mockCache.remove).toHaveBeenCalledWith('test-key');
      expect(mockLogger.trace).toHaveBeenCalledWith('Deleted item with key: test-key');
    });

    it('should handle non-existent item deletion', async () => {
      mockCache.remove.mockResolvedValue(null);

      const result = await adapter.del('test-key');

      expect(result).toBe(false);
    });

    it('should handle delete errors', async () => {
      mockCache.remove.mockRejectedValue(new Error('Delete failed'));

      const result = await adapter.del('test-key');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to delete item with key: test-key', expect.any(Error));
    });
  });

  describe('locking operations', () => {
    let mockLock: any;

    beforeEach(async () => {
      await adapter.initialize();
      mockLock = {
        tryLock: jest.fn(),
        unlock: jest.fn()
      };
      mockClient.getOrCreateLock.mockReturnValue(mockLock);
    });

    it('should acquire lock successfully', async () => {
      mockLock.tryLock.mockResolvedValue(true);
      mockCache.put.mockResolvedValue(undefined);

      const result = await adapter.acquireLock('test-key');

      expect(result).toBe(true);
      expect(mockLock.tryLock).toHaveBeenCalledWith(1000);
      expect(mockCache.put).toHaveBeenCalledWith('test-key_lock', expect.stringContaining('lock_owner'));
      expect(mockLogger.trace).toHaveBeenCalledWith('Lock acquired for key: test-key');
    });

    it('should handle lock acquisition failure', async () => {
      mockLock.tryLock.mockResolvedValue(false);

      const result = await adapter.acquireLock('test-key');

      expect(result).toBe(false);
    });

    it('should release lock successfully', async () => {
      mockLock.unlock.mockResolvedValue(true);
      mockCache.remove.mockResolvedValue(true);

      const result = await adapter.releaseLock('test-key');

      expect(result).toBe(true);
      expect(mockLock.unlock).toHaveBeenCalled();
      expect(mockCache.remove).toHaveBeenCalledWith('test-key_lock');
      expect(mockLogger.trace).toHaveBeenCalledWith('Lock released for key: test-key');
    });

    it('should handle lock release failure', async () => {
      mockLock.unlock.mockResolvedValue(false);

      const result = await adapter.releaseLock('test-key');

      expect(result).toBe(false);
    });

    it('should check if lock exists', async () => {
      const lockInfo = {
        owner: 'lock_owner',
        expiresAt: Date.now() + 10000
      };
      mockCache.get.mockResolvedValue(JSON.stringify(lockInfo));

      const result = await adapter.isLockExists('test-key');

      expect(result).toBe(true);
      expect(mockCache.get).toHaveBeenCalledWith('test-key_lock');
    });

    it('should handle expired locks', async () => {
      const lockInfo = {
        owner: 'lock_owner',
        expiresAt: Date.now() - 1000 // Expired
      };
      mockCache.get.mockResolvedValue(JSON.stringify(lockInfo));
      mockCache.remove.mockResolvedValue(true);

      const result = await adapter.isLockExists('test-key');

      expect(result).toBe(false);
      expect(mockCache.remove).toHaveBeenCalledWith('test-key_lock');
    });

    it('should handle non-existent locks', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await adapter.isLockExists('test-key');

      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should cleanup expired items and locks', async () => {
      const now = Date.now();
      const entries = [
        ['key1', JSON.stringify({
          value: 'value1',
          expiresAt: now - 1000 // Expired
        })],
        ['key2_lock', JSON.stringify({
          owner: 'lock_owner',
          expiresAt: now - 1000 // Expired lock
        })],
        ['key3', JSON.stringify({
          value: 'value3',
          expiresAt: now + 1000 // Not expired
        })]
      ];

      mockCache.entries.mockResolvedValue(entries);
      mockCache.remove.mockResolvedValue(true);

      await adapter.cleanup();

      expect(mockCache.remove).toHaveBeenCalledWith('key1');
      expect(mockCache.remove).toHaveBeenCalledWith('key2_lock');
      expect(mockLogger.info).toHaveBeenCalledWith('Cleanup completed: 1 expired items removed, 1 expired locks cleared');
    });

    it('should handle cleanup errors', async () => {
      mockCache.entries.mockRejectedValue(new Error('Cleanup failed'));

      await expect(adapter.cleanup()).rejects.toThrow('Cleanup failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to cleanup Ignite storage', expect.any(Error));
    });
  });

  describe('close', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should close successfully', async () => {
      await adapter.close();

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.DISCONNECTED);
      expect(mockLogger.info).toHaveBeenCalledWith('Ignite adapter closed successfully');
    });

    it('should handle close errors', async () => {
      mockClient.disconnect.mockRejectedValue(new Error('Close failed'));

      await expect(adapter.close()).rejects.toThrow('Close failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to close Ignite adapter', expect.any(Error));
    });
  });
}); 