import { ConnectionStatus } from "../ConnectionStatus";
import { StorageAdapter } from "../StorageAdapter";

export type InMemoryStorageAdapterOptions = {
  maxSize?: number; // Maximum number of items in cache
  cleanupInterval?: number; // Interval in ms to clean up expired items
};

const DEFAULT_MAX_SIZE = 10000;
const DEFAULT_CLEANUP_INTERVAL = 60000; // 1 minute

interface CacheItem {
  value: string;
  expiresAt: number | undefined;
  createdAt: number;
}

/**
 * In-Memory storage adapter for development, testing, and single-instance applications.
 * Implements the StorageAdapter interface with automatic cleanup of expired items.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private storage = new Map<string, CacheItem>();
  private locks = new Set<string>();
  private connectionStatus: ConnectionStatus = ConnectionStatus.CONNECTED;
  private cleanupTimer: NodeJS.Timeout | undefined;
  private options: Required<InMemoryStorageAdapterOptions>;

  constructor(options?: InMemoryStorageAdapterOptions) {
    this.options = {
      maxSize: DEFAULT_MAX_SIZE,
      cleanupInterval: DEFAULT_CLEANUP_INTERVAL,
      ...options,
    };

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Returns the current connection status (always CONNECTED for in-memory)
   */
  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Calls the callback immediately since in-memory storage is always ready
   */
  public onConnect(callback: (...args: unknown[]) => void): void {
    // In-memory storage is always ready, so call immediately
    setImmediate(callback);
  }

  /**
   * Sets a value in the in-memory cache
   */
  public async set(key: string, value: string, expiresIn?: number): Promise<boolean> {
    const expiresAt = expiresIn ? Date.now() + expiresIn : undefined;
    
    // Check if we need to evict items due to size limit
    if (this.storage.size >= this.options.maxSize && !this.storage.has(key)) {
      this.evictOldest();
    }

    this.storage.set(key, {
      value,
      expiresAt,
      createdAt: Date.now(),
    });

    return true;
  }

  /**
   * Sets multiple values in the in-memory cache
   */
  public async mset(values: Map<string, string>): Promise<void> {
    const now = Date.now();
    
    for (const [key, value] of values.entries()) {
      // Check if we need to evict items due to size limit
      if (this.storage.size >= this.options.maxSize && !this.storage.has(key)) {
        this.evictOldest();
      }

      this.storage.set(key, {
        value,
        expiresAt: undefined, // No expiration for mset
        createdAt: now,
      });
    }
  }

  /**
   * Gets a value from the in-memory cache
   */
  public async get(key: string): Promise<string | null> {
    const item = this.storage.get(key);
    if (!item) return null;

    // Check if item has expired
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.storage.delete(key);
      return null;
    }

    return item.value;
  }

  /**
   * Gets multiple values from the in-memory cache
   */
  public async mget(keys: string[]): Promise<(string | null)[]> {
    const now = Date.now();
    const results: (string | null)[] = [];

    for (const key of keys) {
      const item = this.storage.get(key);
      
      if (!item) {
        results.push(null);
        continue;
      }

      // Check if item has expired
      if (item.expiresAt && now > item.expiresAt) {
        this.storage.delete(key);
        results.push(null);
        continue;
      }

      results.push(item.value);
    }

    return results;
  }

  /**
   * Deletes a value from the in-memory cache
   */
  public async del(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  /**
   * Acquires a lock on a key
   */
  public async acquireLock(key: string, lockExpireTimeout?: number): Promise<boolean> {
    const lockKey = `${key}_lock`;
    const expiresAt = lockExpireTimeout ? Date.now() + lockExpireTimeout : Date.now() + 20000;

    // Check if lock already exists and is not expired
    const lockItem = this.storage.get(lockKey);
    if (lockItem && (!lockItem.expiresAt || Date.now() < lockItem.expiresAt)) {
      return false;
    }

    // Add lock to storage with expiration
    this.storage.set(lockKey, {
      value: "locked",
      expiresAt,
      createdAt: Date.now(),
    });

    this.locks.add(lockKey);
    return true;
  }

  /**
   * Releases a lock on a key
   */
  public async releaseLock(key: string): Promise<boolean> {
    const lockKey = `${key}_lock`;
    const wasLocked = this.locks.has(lockKey);
    
    this.storage.delete(lockKey);
    this.locks.delete(lockKey);
    
    return wasLocked;
  }

  /**
   * Checks if a key is locked
   */
  public async isLockExists(key: string): Promise<boolean> {
    const lockKey = `${key}_lock`;
    const lockItem = this.storage.get(lockKey);
    if (!lockItem) return false;
    if (lockItem.expiresAt && Date.now() > lockItem.expiresAt) {
      this.storage.delete(lockKey);
      this.locks.delete(lockKey);
      return false;
    }
    return true;
  }

  /**
   * Sets options (no-op for in-memory adapter)
   */
  public setOptions(): void {
    // No-op for in-memory adapter
  }

  /**
   * Cleans up expired items from the cache
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.storage.entries()) {
      if (item.expiresAt && now > item.expiresAt) {
        keysToDelete.push(key);
      }
    }

    // Delete expired items
    for (const key of keysToDelete) {
      this.storage.delete(key);
      this.locks.delete(key);
    }
  }

  /**
   * Evicts the oldest non-lock item from the cache when size limit is reached
   */
  private evictOldest(): void {
    let oldestKey: string | undefined = undefined;
    let oldestTime: number | undefined = undefined;

    for (const [key, item] of this.storage.entries()) {
      if (key.endsWith('_lock')) continue; // Don't evict locks
      if (oldestTime === undefined || item.createdAt < oldestTime) {
        oldestTime = item.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.storage.delete(oldestKey);
    }
  }

  /**
   * Starts the cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  /**
   * Stops the cleanup timer and cleans up resources
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.storage.clear();
    this.locks.clear();
  }

  /**
   * Gets cache statistics for monitoring
   */
  public getStats(): {
    size: number;
    locks: number;
    maxSize: number;
  } {
    return {
      size: this.storage.size,
      locks: this.locks.size,
      maxSize: this.options.maxSize,
    };
  }
}

export default InMemoryStorageAdapter; 