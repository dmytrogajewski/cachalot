import { StorageAdapter, StorageAdapterOptions } from '../StorageAdapter';
import { ConnectionStatus } from '../ConnectionStatus';
import { Logger } from '../Logger';
import { HazelcastClient, Client, IMap, HazelcastClientConfiguration } from 'hazelcast-client';

interface HazelcastConfig {
  clientConfig?: HazelcastClientConfiguration;
  mapName?: string;
  logger?: Logger;
}

export class HazelcastStorageAdapter implements StorageAdapter {
  private clientConfig: HazelcastClientConfiguration;
  private mapName: string;
  private logger: Logger;
  private client: HazelcastClient | null = null;
  private map: IMap<string, string> | null = null;
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

  constructor(config: HazelcastConfig) {
    this.clientConfig = config.clientConfig || {};
    this.mapName = config.mapName || 'cachalot_cache';
    this.logger = config.logger || console;
    
    this.logger.info(`Initializing Hazelcast adapter with map: ${this.mapName}`);
  }

  async initialize(): Promise<void> {
    try {
      this.client = await Client.newHazelcastClient(this.clientConfig);
      this.map = await this.client.getMap(this.mapName);

      this.connectionStatus = ConnectionStatus.CONNECTED;
      this.logger.info('Hazelcast adapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Hazelcast adapter', error);
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
      if (!this.map) {
        throw new Error('Map not initialized');
      }

      const cacheEntry = {
        value,
        createdAt: Date.now(),
        expiresAt: expiresIn ? Date.now() + expiresIn : null
      };

      await this.map.set(key, JSON.stringify(cacheEntry));
      
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
      if (!this.map) {
        throw new Error('Map not initialized');
      }

      const entries: Array<[string, string]> = [];
      const now = Date.now();
      
      for (const [key, value] of values.entries()) {
        const cacheEntry = {
          value,
          createdAt: now,
          expiresAt: null
        };
        entries.push([key, JSON.stringify(cacheEntry)]);
      }

      await this.map.setAll(entries);
      
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
      if (!this.map) {
        throw new Error('Map not initialized');
      }

      const entry = await this.map.get(key);
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
      if (!this.map) {
        throw new Error('Map not initialized');
      }

      const results: (string | null)[] = [];
      const now = Date.now();

      for (const key of keys) {
        const entry = await this.map.get(key);
        
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
      if (!this.map) {
        throw new Error('Map not initialized');
      }

      const removed = await this.map.remove(key);
      
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
      if (!this.client) {
        throw new Error('Client not initialized');
      }

      const lockKey = `${key}_lock`;
      const lockExpiresAt = Date.now() + (lockExpireTimeout || 20000);

      const lock = await this.client.getCPSubsystem().getLock(lockKey);
      const acquired = await lock.tryLock(0, 1000)

      if (acquired) {
        const lockInfo = {
          owner: 'lock_owner',
          expiresAt: lockExpiresAt
        };
        await this.map!.set(lockKey, JSON.stringify(lockInfo));
        
        this.logger.trace(`Lock acquired for key: ${key}`);
      }

      return acquired;
    } catch (error) {
      this.logger.error(`Failed to acquire lock for key: ${key}`, error);
      return false;
    }
  }

  public async releaseLock(key: string): Promise<boolean> {
    try {
      if (!this.client || !this.map) {
        throw new Error('Client or map not initialized');
      }

      const lockKey = `${key}_lock`;
      
      const lock = await this.client.getCPSubsystem().getLock(lockKey);
      const released = await lock.tryRelease();

      if (released) {
        await this.map.remove(lockKey);
        this.logger.trace(`Lock released for key: ${key}`);
      }

      return released;
    } catch (error) {
      this.logger.error(`Failed to release lock for key: ${key}`, error);
      return false;
    }
  }

  public async isLockExists(key: string): Promise<boolean> {
    try {
      if (!this.map) {
        throw new Error('Map not initialized');
      }

      const lockKey = `${key}_lock`;
      const entry = await this.map.get(lockKey);
      
      if (!entry) {
        return false;
      }

      const lockInfo = JSON.parse(entry);
      
      if (lockInfo.expiresAt && lockInfo.expiresAt < Date.now()) {
        await this.map.remove(lockKey);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to check lock for key: ${key}`, error);
      return false;
    }
  }

  public setOptions?(options: StorageAdapterOptions): void {
    // Hazelcast adapter doesn't need to handle options
  }

  public async cleanup(): Promise<void> {
    try {
      if (!this.map) {
        throw new Error('Map not initialized');
      }

      const now = Date.now();
      const entries = await this.map.entrySet();
      let expiredCount = 0;
      let lockCount = 0;

      for (const [key, value] of entries) {
        try {
          const entry = JSON.parse(value);
          
          if (entry.expiresAt && entry.expiresAt < now) {
            await this.map.remove(key);
            expiredCount++;
          }
          
          if (key.endsWith('_lock') && entry.expiresAt && entry.expiresAt < now) {
            await this.map.remove(key);
            lockCount++;
          }
        } catch (error) {
          continue;
        }
      }

      this.logger.info(`Cleanup completed: ${expiredCount} expired items removed, ${lockCount} expired locks cleared`);
    } catch (error) {
      this.logger.error('Failed to cleanup Hazelcast storage', error);
      throw error;
    }
  }

  public async close(): Promise<void> {
    try {
      if (this.client) {
        await this.client.shutdown();
        this.connectionStatus = ConnectionStatus.DISCONNECTED;
        this.logger.info('Hazelcast adapter closed successfully');
      }
    } catch (error) {
      this.logger.error('Failed to close Hazelcast adapter', error);
      throw error;
    }
  }
} 