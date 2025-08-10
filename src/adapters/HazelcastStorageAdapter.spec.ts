import { HazelcastStorageAdapter } from './HazelcastStorageAdapter';
import { ConnectionStatus } from '../ConnectionStatus';
import { Logger } from '../Logger';

// Mock the hazelcast-client module
jest.mock('hazelcast-client', () => ({
  Client: {
    newHazelcastClient: jest.fn()
  }
}), { virtual: true });

describe('HazelcastStorageAdapter', () => {
  let adapter: HazelcastStorageAdapter;
  let mockClient: any;
  let mockMap: any;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn()
    } as jest.Mocked<Logger>;

    mockMap = {
      set: jest.fn(),
      setAll: jest.fn(),
      get: jest.fn(),
      remove: jest.fn(),
      entrySet: jest.fn()
    };

    mockClient = {
      getMap: jest.fn().mockResolvedValue(mockMap),
      getCPSubsystem: jest.fn().mockReturnValue({
        getLock: jest.fn().mockReturnValue({
          tryLock: jest.fn(),
          tryRelease: jest.fn()
        })
      }),
      shutdown: jest.fn()
    };

    const { Client } = require('hazelcast-client');
    Client.newHazelcastClient.mockResolvedValue(mockClient);

    adapter = new HazelcastStorageAdapter({
      clientConfig: { test: true },
      mapName: 'test_cache',
      logger: mockLogger
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await adapter.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith('Initializing Hazelcast adapter with map: test_cache');
      expect(mockLogger.info).toHaveBeenCalledWith('Hazelcast adapter initialized successfully');
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.CONNECTED);
    });

    it('should handle initialization errors', async () => {
      const { Client } = require('hazelcast-client');
      Client.newHazelcastClient.mockRejectedValue(new Error('Connection failed'));

      await expect(adapter.initialize()).rejects.toThrow('Connection failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Hazelcast adapter', expect.any(Error));
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
      mockMap.set.mockResolvedValue(undefined);

      const result = await adapter.set('test-key', 'test-value');

      expect(result).toBe(true);
      expect(mockMap.set).toHaveBeenCalledWith('test-key', expect.stringContaining('test-value'));
    });

    it('should set item with TTL', async () => {
      mockMap.set.mockResolvedValue(undefined);

      const result = await adapter.set('test-key', 'test-value', 5000);

      expect(result).toBe(true);
      expect(mockMap.set).toHaveBeenCalledWith('test-key', expect.stringContaining('test-value'));
      expect(mockLogger.trace).toHaveBeenCalledWith('Set item with key: test-key, TTL: 5000ms');
    });

    it('should handle set errors', async () => {
      mockMap.set.mockRejectedValue(new Error('Set failed'));

      const result = await adapter.set('test-key', 'test-value');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to set item with key: test-key', expect.any(Error));
    });

    it('should set multiple items', async () => {
      mockMap.setAll.mockResolvedValue(undefined);

      const values = new Map([
        ['key1', 'value1'],
        ['key2', 'value2']
      ]);

      await adapter.mset(values);

      expect(mockMap.setAll).toHaveBeenCalledWith([
        ['key1', expect.stringContaining('value1')],
        ['key2', expect.stringContaining('value2')]
      ]);
      expect(mockLogger.trace).toHaveBeenCalledWith('Set 2 items');
    });

    it('should handle mset errors', async () => {
      mockMap.setAll.mockRejectedValue(new Error('MSet failed'));

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
      mockMap.get.mockResolvedValue(JSON.stringify(cacheEntry));

      const result = await adapter.get('test-key');

      expect(result).toBe('test-value');
      expect(mockMap.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null for non-existent item', async () => {
      mockMap.get.mockResolvedValue(null);

      const result = await adapter.get('test-key');

      expect(result).toBe(null);
    });

    it('should handle expired items', async () => {
      const cacheEntry = {
        value: 'test-value',
        createdAt: Date.now(),
        expiresAt: Date.now() - 1000 // Expired
      };
      mockMap.get.mockResolvedValue(JSON.stringify(cacheEntry));
      mockMap.remove.mockResolvedValue(true);

      const result = await adapter.get('test-key');

      expect(result).toBe(null);
      expect(mockMap.remove).toHaveBeenCalledWith('test-key');
    });

    it('should handle get errors', async () => {
      mockMap.get.mockRejectedValue(new Error('Get failed'));

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

      mockMap.get
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

      mockMap.get
        .mockResolvedValueOnce(JSON.stringify(cacheEntry))
        .mockResolvedValueOnce(null);

      const results = await adapter.mget(['key1', 'key2']);

      expect(results).toEqual(['value1', null]);
    });

    it('should handle mget errors', async () => {
      mockMap.get.mockRejectedValue(new Error('MGet failed'));

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
      mockMap.remove.mockResolvedValue('deleted-value');

      const result = await adapter.del('test-key');

      expect(result).toBe(true);
      expect(mockMap.remove).toHaveBeenCalledWith('test-key');
      expect(mockLogger.trace).toHaveBeenCalledWith('Deleted item with key: test-key');
    });

    it('should handle non-existent item deletion', async () => {
      mockMap.remove.mockResolvedValue(null);

      const result = await adapter.del('test-key');

      expect(result).toBe(false);
    });

    it('should handle delete errors', async () => {
      mockMap.remove.mockRejectedValue(new Error('Delete failed'));

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
        tryRelease: jest.fn()
      };
      mockClient.getCPSubsystem().getLock.mockReturnValue(mockLock);
    });

    it('should acquire lock successfully', async () => {
      mockLock.tryLock.mockResolvedValue(true);
      mockMap.set.mockResolvedValue(undefined);

      const result = await adapter.acquireLock('test-key');

      expect(result).toBe(true);
      expect(mockLock.tryLock).toHaveBeenCalledWith(0, 1000);
      expect(mockMap.set).toHaveBeenCalledWith('test-key_lock', expect.stringContaining('lock_owner'));
      expect(mockLogger.trace).toHaveBeenCalledWith('Lock acquired for key: test-key');
    });

    it('should handle lock acquisition failure', async () => {
      mockLock.tryLock.mockResolvedValue(false);

      const result = await adapter.acquireLock('test-key');

      expect(result).toBe(false);
    });

    it('should release lock successfully', async () => {
      mockLock.tryRelease.mockResolvedValue(true);
      mockMap.remove.mockResolvedValue(true);

      const result = await adapter.releaseLock('test-key');

      expect(result).toBe(true);
      expect(mockLock.tryRelease).toHaveBeenCalled();
      expect(mockMap.remove).toHaveBeenCalledWith('test-key_lock');
      expect(mockLogger.trace).toHaveBeenCalledWith('Lock released for key: test-key');
    });

    it('should handle lock release failure', async () => {
      mockLock.tryRelease.mockResolvedValue(false);

      const result = await adapter.releaseLock('test-key');

      expect(result).toBe(false);
    });

    it('should check if lock exists', async () => {
      const lockInfo = {
        owner: 'lock_owner',
        expiresAt: Date.now() + 10000
      };
      mockMap.get.mockResolvedValue(JSON.stringify(lockInfo));

      const result = await adapter.isLockExists('test-key');

      expect(result).toBe(true);
      expect(mockMap.get).toHaveBeenCalledWith('test-key_lock');
    });

    it('should handle expired locks', async () => {
      const lockInfo = {
        owner: 'lock_owner',
        expiresAt: Date.now() - 1000 // Expired
      };
      mockMap.get.mockResolvedValue(JSON.stringify(lockInfo));
      mockMap.remove.mockResolvedValue(true);

      const result = await adapter.isLockExists('test-key');

      expect(result).toBe(false);
      expect(mockMap.remove).toHaveBeenCalledWith('test-key_lock');
    });

    it('should handle non-existent locks', async () => {
      mockMap.get.mockResolvedValue(null);

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

      mockMap.entrySet.mockResolvedValue(entries);
      mockMap.remove.mockResolvedValue(true);

      await adapter.cleanup();

      expect(mockMap.remove).toHaveBeenCalledWith('key1');
      expect(mockMap.remove).toHaveBeenCalledWith('key2_lock');
      expect(mockLogger.info).toHaveBeenCalledWith('Cleanup completed: 1 expired items removed, 1 expired locks cleared');
    });

    it('should handle cleanup errors', async () => {
      mockMap.entrySet.mockRejectedValue(new Error('Cleanup failed'));

      await expect(adapter.cleanup()).rejects.toThrow('Cleanup failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to cleanup Hazelcast storage', expect.any(Error));
    });
  });

  describe('close', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should close successfully', async () => {
      await adapter.close();

      expect(mockClient.shutdown).toHaveBeenCalled();
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.DISCONNECTED);
      expect(mockLogger.info).toHaveBeenCalledWith('Hazelcast adapter closed successfully');
    });

    it('should handle close errors', async () => {
      mockClient.shutdown.mockRejectedValue(new Error('Close failed'));

      await expect(adapter.close()).rejects.toThrow('Close failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to close Hazelcast adapter', expect.any(Error));
    });
  });
}); 