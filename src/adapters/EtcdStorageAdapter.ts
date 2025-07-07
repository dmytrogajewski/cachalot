import { StorageAdapter, StorageAdapterOptions } from '../StorageAdapter';
import { ConnectionStatus } from '../ConnectionStatus';
import { Logger } from '../Logger';
import { Etcd3, Namespace } from 'etcd3';

interface EtcdConfig {
  hosts?: string[];
  credentials?: {
    rootCertificate?: Buffer;
    privateKey?: Buffer;
    certChain?: Buffer;
  };
  namespace?: string;
  logger?: Logger;
}

export class EtcdStorageAdapter implements StorageAdapter {
  private hosts: string[];
  private credentials: {
    rootCertificate?: Buffer;
    privateKey?: Buffer;
    certChain?: Buffer;
  } | undefined;
  private namespace: string;
  private logger: Logger;
  private client: Etcd3 | null = null;
  private namespaceClient: Namespace | null = null; // Etcd3 namespace for operations
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

  constructor(config: EtcdConfig) {
    this.hosts = config.hosts || ['localhost:2379'];
    this.credentials = config.credentials || undefined;
    this.namespace = config.namespace || 'cachalot';
    this.logger = config.logger || console;
    
    this.logger.info(`Initializing Etcd adapter with namespace: ${this.namespace}`);
  }

  async initialize(): Promise<void> {
    try {
      const clientOptions: any = {
        hosts: this.hosts
      };
      
      if (this.credentials) {
        clientOptions.credentials = this.credentials;
      }
      
      this.client = new Etcd3(clientOptions);
      this.namespaceClient = this.client.namespace(this.namespace);

      this.connectionStatus = ConnectionStatus.CONNECTED;
      this.logger.info('Etcd adapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Etcd adapter', error);
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
      // Wait for connection
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

  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  public async set(key: string, value: string, expiresIn?: number): Promise<boolean> {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const cacheEntry = {
        value,
        createdAt: Date.now(),
        expiresAt: expiresIn ? Date.now() + expiresIn : null
      };

      if (!this.namespaceClient) {
        throw new Error('Namespace client not initialized');
      }

      const lease = expiresIn && this.client ? this.client.lease(expiresIn / 1000) : undefined;
      
      if (lease) {
        await this.namespaceClient.put(namespacedKey, JSON.stringify(cacheEntry)).lease(lease).exec();
      } else {
        await this.namespaceClient.put(namespacedKey, JSON.stringify(cacheEntry)).exec();
      }
      
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
      const now = Date.now();
      
      for (const [key, value] of values.entries()) {
        const namespacedKey = this.getNamespacedKey(key);
        const cacheEntry = {
          value,
          createdAt: now,
          expiresAt: null
        };
        if (!this.namespaceClient) {
          throw new Error('Namespace client not initialized');
        }
        await this.namespaceClient.put(namespacedKey, JSON.stringify(cacheEntry)).exec();
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
      const namespacedKey = this.getNamespacedKey(key);
      if (!this.namespaceClient) {
        throw new Error('Namespace client not initialized');
      }
      const entry = await this.namespaceClient.get(namespacedKey).string();
      
      if (!entry) {
        return null;
      }

      const cacheEntry = JSON.parse(entry);
      
      // Check if item has expired (fallback check)
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
      const results: (string | null)[] = [];
      const now = Date.now();

      for (const key of keys) {
        const namespacedKey = this.getNamespacedKey(key);
        if (!this.namespaceClient) {
          throw new Error('Namespace client not initialized');
        }
        const entry = await this.namespaceClient.get(namespacedKey).string();
        
        if (!entry) {
          results.push(null);
          continue;
        }

        const cacheEntry = JSON.parse(entry);
        
        // Check if item has expired (fallback check)
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
      const namespacedKey = this.getNamespacedKey(key);
      if (!this.namespaceClient) {
        throw new Error('Namespace client not initialized');
      }
      await this.namespaceClient.delete(namespacedKey).exec();
      
      this.logger.trace(`Deleted item with key: ${key}`);
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete item with key: ${key}`, error);
      return false;
    }
  }

  public async acquireLock(key: string, lockExpireTimeout?: number): Promise<boolean> {
    try {
      const lockKey = this.getNamespacedKey(`${key}_lock`);
      const lockExpiresAt = Date.now() + (lockExpireTimeout || 20000);

      if (!this.namespaceClient) {
        throw new Error('Namespace client not initialized');
      }
      // Try to acquire lock using Etcd's distributed lock
      const lock = this.client!.lock(lockKey);
      try {
        await lock.acquire(1000); // Try for 1 second
        
        // Store lock info with expiration
        const lockInfo = {
          owner: 'lock_owner',
          expiresAt: lockExpiresAt
        };
        await this.namespaceClient.put(lockKey, JSON.stringify(lockInfo)).exec();
        
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
      const lockKey = this.getNamespacedKey(`${key}_lock`);
      
      if (!this.namespaceClient) {
        throw new Error('Namespace client not initialized');
      }
      // Release the distributed lock
      const lock = this.client!.lock(lockKey);
      try {
        await lock.release();
        
        // Remove lock info
        await this.namespaceClient.delete(lockKey).exec();
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
      const lockKey = this.getNamespacedKey(`${key}_lock`);
      if (!this.namespaceClient) {
        throw new Error('Namespace client not initialized');
      }
      const entry = await this.namespaceClient.get(lockKey).string();
      
      if (!entry) {
        return false;
      }

      const lockInfo = JSON.parse(entry);
      
      // Check if lock has expired
      if (lockInfo.expiresAt && lockInfo.expiresAt < Date.now()) {
        await this.namespaceClient.delete(lockKey).exec();
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to check lock for key: ${key}`, error);
      return false;
    }
  }

  public setOptions?(options: StorageAdapterOptions): void {
    // Etcd adapter doesn't need to handle options
  }

  public async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      if (!this.namespaceClient) {
        throw new Error('Namespace client not initialized');
      }
      const prefix = this.getNamespacedKey('');
      const entries = await this.namespaceClient.getAll().prefix(prefix);
      let expiredCount = 0;
      let lockCount = 0;

      for (const [key, value] of Object.entries(entries)) {
        try {
          const entry = JSON.parse(value as string);
          
          // Check for expired items
          if (entry.expiresAt && entry.expiresAt < now) {
            await this.namespaceClient.delete(key).exec();
            expiredCount++;
          }
          
          // Check for expired locks
          if (key.endsWith('_lock') && entry.expiresAt && entry.expiresAt < now) {
            await this.namespaceClient.delete(key).exec();
            lockCount++;
          }
        } catch (error) {
          // Skip invalid entries
          continue;
        }
      }

      this.logger.info(`Cleanup completed: ${expiredCount} expired items removed, ${lockCount} expired locks cleared`);
    } catch (error) {
      this.logger.error('Failed to cleanup Etcd storage', error);
      throw error;
    }
  }

  public async close(): Promise<void> {
    try {
      if (this.client) {
        await (this.client as any).close();
        this.namespaceClient = null;
        this.connectionStatus = ConnectionStatus.DISCONNECTED;
        this.logger.info('Etcd adapter closed successfully');
      }
    } catch (error) {
      this.logger.error('Failed to close Etcd adapter', error);
      throw error;
    }
  }
} 