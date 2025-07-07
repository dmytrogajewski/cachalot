import { StorageAdapter, StorageAdapterOptions } from '../StorageAdapter';
import { ConnectionStatus } from '../ConnectionStatus';
import { Logger } from '../Logger';
import { CacheClient, CacheEntry } from 'apache-ignite-client';

interface IgniteConfig {
  endpoint?: string;
  username?: string;
  password?: string;
  cacheName?: string;
  logger?: Logger;
}

export class IgniteStorageAdapter implements StorageAdapter {
  private endpoint: string;
  private username: string | undefined;
  private password: string | undefined;
  private cacheName: string;
  private logger: Logger;
  private client: CacheClient | null = null;
  private cache: CacheEntry | null = null;
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

  constructor(config: IgniteConfig) {
    this.endpoint = config.endpoint || 'localhost:10800';
    this.username = config.username || undefined;
    this.password = config.password || undefined;
    this.cacheName = config.cacheName || 'cachalot_cache';
    this.logger = config.logger || console;
    
    this.logger.info(`Initializing Ignite adapter with cache: ${this.cacheName}`);
  }

  async initialize(): Promise<void> {
    try {
      const { CacheClient } = await import('apache-ignite-client');
      
      this.client = new CacheClient();
      
      const connectionOptions: import('apache-ignite-client').IgniteClientConfiguration = {
        endpoint: this.endpoint
      };
      
      if (this.username && this.password) {
        connectionOptions.username = this.username;
        connectionOptions.password = this.password;
      }
      
      await this.client.connect(connectionOptions);
      this.cache = await this.client.getOrCreateCache(this.cacheName);

      this.connectionStatus = ConnectionStatus.CONNECTED;
      this.logger.info('Ignite adapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Ignite adapter', error);
      throw error;
    }
  }

  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  public onConnect(callback: (...args: unknown[]) => void): void {
    if (this.connectionStatus === ConnectionStatus.CONNECTED) {
      setImmediate(callback);
    } else {
      const checkConnection = () => {
        if (this.connectionStatus === ConnectionStatus.CONNECTED) {
          callback();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    }
  }

  public async set(key: string, value: string, expiresIn?: number): Promise<boolean> {
    try {
      if (!this.cache) {
        throw new Error('Cache not initialized');
      }

      const cacheEntry = {
        value,
        createdAt: Date.now(),
        expiresAt: expiresIn ? Date.now() + expiresIn : null
      };

      await this.cache.put(key, JSON.stringify(cacheEntry));
      
      if (expiresIn) {
        this.logger.trace(`Set item with key: ${key}, TTL: ${expiresIn}ms`);
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to set item with key: ${key}`, error);
      return false;
    }
  }

  public async mset(values: Map<string, string>): Promise<void> {
    try {
      if (!this.cache) {
        throw new Error('Cache not initialized');
      }

      const now = Date.now();
      
      for (const [key, value] of Array.from(values.entries())) {
        const cacheEntry = {
          value,
          createdAt: now,
          expiresAt: null
        };
        await this.cache.put(key, JSON.stringify(cacheEntry));
      }

      if (values.size > 0) {
        this.logger.trace(`Set ${values.size} items`);
      }
    } catch (error) {
      this.logger.error('Failed to set multiple items', error);
      throw error;
    }
  }

  public async get(key: string): Promise<string | null> {
    try {
      if (!this.cache) {
        throw new Error('Cache not initialized');
      }

      const entry = await this.cache.get(key);
      if (!entry) {
        return null;
      }

      const cacheEntry = JSON.parse(entry);
      
      if (cacheEntry.expiresAt && cacheEntry.expiresAt < Date.now()) {
        await this.del(key);
        return null;
      }

      return cacheEntry.value;
    } catch (error) {
      this.logger.error(`Failed to get item with key: ${key}`, error);
      return null;
    }
  }

  public async mget(keys: string[]): Promise<(string | null)[]> {
    try {
      if (!this.cache) {
        throw new Error('Cache not initialized');
      }

      const results: (string | null)[] = [];
      const now = Date.now();

      for (const key of keys) {
        const entry = await this.cache.get(key);
        
        if (!entry) {
          results.push(null);
          continue;
        }

        const cacheEntry = JSON.parse(entry);
        
        if (cacheEntry.expiresAt && cacheEntry.expiresAt < now) {
          await this.del(key);
          results.push(null);
          continue;
        }

        results.push(cacheEntry.value);
      }

      return results;
    } catch (error) {
      this.logger.error('Failed to get multiple items', error);
      return keys.map(() => null);
    }
  }

  public async del(key: string): Promise<boolean> {
    try {
      if (!this.cache) {
        throw new Error('Cache not initialized');
      }

      const removed = await this.cache.remove(key);
      
      if (removed) {
        this.logger.trace(`Deleted item with key: ${key}`);
      }
      
      return !!removed;
    } catch (error) {
      this.logger.error(`Failed to delete item with key: ${key}`, error);
      return false;
    }
  }

  public async acquireLock(key: string, lockExpireTimeout?: number): Promise<boolean> {
    try {
      if (!this.client || !this.cache) {
        throw new Error('Client or cache not initialized');
      }

      const lockKey = `${key}_lock`;
      const lockExpiresAt = Date.now() + (lockExpireTimeout || 20000);

      const lock = await this.client.getOrCreateLock(lockKey);
      try {
        await lock.tryLock(1000);
        
        const lockInfo = {
          owner: 'lock_owner',
          expiresAt: lockExpiresAt
        };
        await this.cache.put(lockKey, JSON.stringify(lockInfo));
        
        this.logger.trace(`Lock acquired for key: ${key}`);
        return true;
      } catch (error) {
        this.logger.trace(`Failed to acquire lock for key: ${key}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to acquire lock for key: ${key}`, error);
      return false;
    }
  }

  public async releaseLock(key: string): Promise<boolean> {
    try {
      if (!this.client || !this.cache) {
        throw new Error('Client or cache not initialized');
      }

      const lockKey = `${key}_lock`;
      
      const lock = await this.client.getOrCreateLock(lockKey);
      try {
        await lock.unlock();
        await this.cache.remove(lockKey);
        this.logger.trace(`Lock released for key: ${key}`);
        return true;
      } catch (error) {
        this.logger.trace(`Failed to release lock for key: ${key}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to release lock for key: ${key}`, error);
      return false;
    }
  }

  public async isLockExists(key: string): Promise<boolean> {
    try {
      if (!this.cache) {
        throw new Error('Cache not initialized');
      }

      const lockKey = `${key}_lock`;
      const entry = await this.cache.get(lockKey);
      
      if (!entry) {
        return false;
      }

      const lockInfo = JSON.parse(entry);
      
      if (lockInfo.expiresAt && lockInfo.expiresAt < Date.now()) {
        await this.cache.remove(lockKey);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to check lock for key: ${key}`, error);
      return false;
    }
  }

  public setOptions?(options: StorageAdapterOptions): void {
    // Ignite adapter doesn't need to handle options
  }

  public async cleanup(): Promise<void> {
    try {
      if (!this.cache) {
        throw new Error('Cache not initialized');
      }

      // Note: Ignite CacheEntry doesn't support entries() method
      // This is a limitation of the current implementation
      // In a real implementation, you would need to use Ignite's query capabilities
      // or maintain a separate index of keys
      this.logger.info('Cleanup not implemented for Ignite adapter - requires query capabilities');
    } catch (error) {
      this.logger.error('Failed to cleanup Ignite storage', error);
      throw error;
    }
  }

  public async close(): Promise<void> {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.connectionStatus = ConnectionStatus.DISCONNECTED;
        this.logger.info('Ignite adapter closed successfully');
      }
    } catch (error) {
      this.logger.error('Failed to close Ignite adapter', error);
      throw error;
    }
  }
} 