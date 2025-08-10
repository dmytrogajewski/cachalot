import { EtcdStorageAdapter } from './EtcdStorageAdapter';
import { ConnectionStatus } from '../ConnectionStatus';
import { Logger } from '../Logger';

// Mock the etcd3 module
jest.mock('etcd3', () => ({
  Etcd3: jest.fn()
}), { virtual: true });

describe('EtcdStorageAdapter', () => {
  let adapter: EtcdStorageAdapter;
  let mockClient: any;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn()
    } as jest.Mocked<Logger>;

    mockClient = {
      put: jest.fn().mockReturnValue({
        lease: jest.fn().mockReturnValue({
          put: jest.fn()
        })
      }),
      get: jest.fn(),
      delete: jest.fn().mockReturnValue({
        key: jest.fn()
      }),
      getAll: jest.fn().mockReturnValue({
        prefix: jest.fn()
      }),
      lock: jest.fn().mockReturnValue({
        acquire: jest.fn(),
        release: jest.fn()
      }),
      lease: jest.fn(),
      close: jest.fn(),
      namespace: jest.fn().mockReturnValue({
        put: jest.fn().mockReturnValue({
          value: jest.fn().mockReturnValue({
            lease: jest.fn().mockReturnValue({
              exec: jest.fn()
            }),
            exec: jest.fn()
          })
        }),
        get: jest.fn().mockReturnValue({
          string: jest.fn()
        }),
        delete: jest.fn().mockReturnValue({
          key: jest.fn().mockReturnValue({
            exec: jest.fn()
          })
        }),
        getAll: jest.fn().mockReturnValue({
          prefix: jest.fn()
        })
      })
    };

    const { Etcd3 } = require('etcd3');
    Etcd3.mockImplementation(() => mockClient);

    adapter = new EtcdStorageAdapter({
      hosts: ['localhost:2379'],
      credentials: {
        rootCertificate: Buffer.from('cert'),
        privateKey: Buffer.from('key'),
        certChain: Buffer.from('chain')
      },
      namespace: 'test_namespace',
      logger: mockLogger
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await adapter.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith('Initializing Etcd adapter with namespace: test_namespace');
      expect(mockLogger.info).toHaveBeenCalledWith('Etcd adapter initialized successfully');
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.CONNECTED);
    });

    it('should initialize without credentials', async () => {
      adapter = new EtcdStorageAdapter({
        hosts: ['localhost:2379'],
        namespace: 'test_namespace',
        logger: mockLogger
      });

      await adapter.initialize();

      const { Etcd3 } = require('etcd3');
      expect(Etcd3).toHaveBeenCalledWith({
        hosts: ['localhost:2379']
      });
    });

    it('should handle initialization errors', async () => {
      const { Etcd3 } = require('etcd3');
      Etcd3.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      await expect(adapter.initialize()).rejects.toThrow('Connection failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Etcd adapter', expect.any(Error));
    });
  });

  describe('connection status', () => {
    it('should return correct connection status', () => {
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.DISCONNECTED);
    });

    it('should call onConnect callback when connected', async () => {
      const callback = jest.fn();
      await adapter.initialize();
      adapter.onConnect(callback);
      // Should be called immediately when already connected
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('set operations', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should set item successfully', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.put().value().exec.mockResolvedValue(undefined);

      const result = await adapter.set('test-key', 'test-value');

      expect(result).toBe(true);
      expect(mockNamespaceClient.put).toHaveBeenCalledWith('test_namespace:test-key');
      expect(mockNamespaceClient.put().value).toHaveBeenCalledWith(expect.stringContaining('test-value'));
    });

    it('should set item with TTL', async () => {
      const mockLease = {
        exec: jest.fn().mockResolvedValue(undefined)
      };
      const mockNamespaceClient = mockClient.namespace();
      mockClient.lease.mockReturnValue(mockLease);
      mockNamespaceClient.put().value().lease().exec.mockResolvedValue(undefined);

      const result = await adapter.set('test-key', 'test-value', 5000);

      expect(result).toBe(true);
      expect(mockClient.lease).toHaveBeenCalledWith(5); // 5000ms / 1000
      expect(mockLogger.trace).toHaveBeenCalledWith('Set item with key: test-key, TTL: 5000ms');
    });

    it('should handle set errors', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.put().value().exec.mockRejectedValue(new Error('Set failed'));

      const result = await adapter.set('test-key', 'test-value');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to set item with key: test-key', expect.any(Error));
    });

    it('should set multiple items', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.put().value().exec.mockResolvedValue(undefined);
      const values = new Map([
        ['key1', 'value1'],
        ['key2', 'value2']
      ]);
      // Clear previous calls from initialization
      mockNamespaceClient.put.mockClear();
      await adapter.mset(values);
      expect(mockNamespaceClient.put).toHaveBeenCalledTimes(2);
      expect(mockNamespaceClient.put).toHaveBeenCalledWith('test_namespace:key1');
      expect(mockNamespaceClient.put).toHaveBeenCalledWith('test_namespace:key2');
      expect(mockLogger.trace).toHaveBeenCalledWith('Set 2 items');
    });

    it('should handle mset errors', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.put().value().exec.mockRejectedValue(new Error('MSet failed'));

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
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string.mockResolvedValue(JSON.stringify(cacheEntry));

      const result = await adapter.get('test-key');

      expect(result).toBe('test-value');
      expect(mockNamespaceClient.get).toHaveBeenCalledWith('test_namespace:test-key');
    });

    it('should return null for non-existent item', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string.mockResolvedValue(null);

      const result = await adapter.get('test-key');

      expect(result).toBe(null);
    });

    it('should handle expired items', async () => {
      const cacheEntry = {
        value: 'test-value',
        createdAt: Date.now(),
        expiresAt: Date.now() - 1000 // Expired
      };
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string.mockResolvedValue(JSON.stringify(cacheEntry));
      mockNamespaceClient.delete().key().exec.mockResolvedValue(undefined);

      const result = await adapter.get('test-key');

      expect(result).toBe(null);
      expect(mockNamespaceClient.delete().key).toHaveBeenCalledWith('test_namespace:test-key');
    });

    it('should handle get errors', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string.mockRejectedValue(new Error('Get failed'));

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

      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string
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

      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string
        .mockResolvedValueOnce(JSON.stringify(cacheEntry))
        .mockResolvedValueOnce(null);

      const results = await adapter.mget(['key1', 'key2']);

      expect(results).toEqual(['value1', null]);
    });

    it('should handle mget errors', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string.mockRejectedValue(new Error('MGet failed'));

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
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.delete().key().exec.mockResolvedValue(undefined);

      const result = await adapter.del('test-key');

      expect(result).toBe(true);
      expect(mockNamespaceClient.delete().key).toHaveBeenCalledWith('test_namespace:test-key');
      expect(mockLogger.trace).toHaveBeenCalledWith('Deleted item with key: test-key');
    });

    it('should handle non-existent item deletion', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.delete().key().exec.mockResolvedValue(undefined);

      const result = await adapter.del('test-key');

      expect(result).toBe(true);
    });

    it('should handle delete errors', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.delete().key().exec.mockRejectedValue(new Error('Delete failed'));

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
        acquire: jest.fn(),
        release: jest.fn()
      };
      mockClient.lock.mockReturnValue(mockLock);
    });

    it('should acquire lock successfully', async () => {
      mockLock.acquire.mockResolvedValue(undefined);
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.put().value().exec.mockResolvedValue(undefined);

      const result = await adapter.acquireLock('test-key');

      expect(result).toBe(true);
      expect(mockLock.acquire).toHaveBeenCalledWith(1000);
      expect(mockNamespaceClient.put).toHaveBeenCalledWith('test_namespace:test-key_lock');
      expect(mockLogger.trace).toHaveBeenCalledWith('Lock acquired for key: test-key');
    });

    it('should handle lock acquisition failure', async () => {
      mockLock.acquire.mockRejectedValue(new Error('Lock acquisition failed'));

      const result = await adapter.acquireLock('test-key');

      expect(result).toBe(false);
    });

    it('should release lock successfully', async () => {
      mockLock.release.mockResolvedValue(undefined);
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.delete().key().exec.mockResolvedValue(undefined);

      const result = await adapter.releaseLock('test-key');

      expect(result).toBe(true);
      expect(mockLock.release).toHaveBeenCalled();
      expect(mockNamespaceClient.delete().key).toHaveBeenCalledWith('test_namespace:test-key_lock');
      expect(mockLogger.trace).toHaveBeenCalledWith('Lock released for key: test-key');
    });

    it('should handle lock release failure', async () => {
      mockLock.release.mockRejectedValue(new Error('Lock release failed'));

      const result = await adapter.releaseLock('test-key');

      expect(result).toBe(false);
    });

    it('should check if lock exists', async () => {
      const lockInfo = {
        owner: 'lock_owner',
        expiresAt: Date.now() + 10000
      };
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string.mockResolvedValue(JSON.stringify(lockInfo));

      const result = await adapter.isLockExists('test-key');

      expect(result).toBe(true);
      expect(mockNamespaceClient.get).toHaveBeenCalledWith('test_namespace:test-key_lock');
    });

    it('should handle expired locks', async () => {
      const lockInfo = {
        owner: 'lock_owner',
        expiresAt: Date.now() - 1000 // Expired
      };
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string.mockResolvedValue(JSON.stringify(lockInfo));
      mockNamespaceClient.delete().key().exec.mockResolvedValue(undefined);

      const result = await adapter.isLockExists('test-key');

      expect(result).toBe(false);
      expect(mockNamespaceClient.delete().key).toHaveBeenCalledWith('test_namespace:test-key_lock');
    });

    it('should handle non-existent locks', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.get().string.mockResolvedValue(null);

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
      const entries = {
        'test_namespace:key1': JSON.stringify({
          value: 'value1',
          expiresAt: now - 1000 // Expired
        }),
        'test_namespace:key2_lock': JSON.stringify({
          owner: 'lock_owner',
          expiresAt: now - 1000 // Expired lock
        }),
        'test_namespace:key3': JSON.stringify({
          value: 'value3',
          expiresAt: now + 1000 // Not expired
        })
      };
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.getAll().prefix.mockResolvedValue(entries);
      mockNamespaceClient.delete().key().exec.mockResolvedValue(undefined);
      await adapter.cleanup();
      expect(mockNamespaceClient.delete().key).toHaveBeenCalledWith('test_namespace:key1');
      expect(mockNamespaceClient.delete().key).toHaveBeenCalledWith('test_namespace:key2_lock');
      expect(mockLogger.info).toHaveBeenCalledWith('Cleanup completed: 2 expired items removed, 1 expired locks cleared');
    });

    it('should handle cleanup errors', async () => {
      const mockNamespaceClient = mockClient.namespace();
      mockNamespaceClient.getAll().prefix.mockRejectedValue(new Error('Cleanup failed'));

      await expect(adapter.cleanup()).rejects.toThrow('Cleanup failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to cleanup Etcd storage', expect.any(Error));
    });
  });

  describe('close', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should close successfully', async () => {
      await adapter.close();

      expect(mockClient.close).toHaveBeenCalled();
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.DISCONNECTED);
      expect(mockLogger.info).toHaveBeenCalledWith('Etcd adapter closed successfully');
    });

    it('should handle close errors', async () => {
      mockClient.close.mockRejectedValue(new Error('Close failed'));

      await expect(adapter.close()).rejects.toThrow('Close failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to close Etcd adapter', expect.any(Error));
    });
  });
}); 