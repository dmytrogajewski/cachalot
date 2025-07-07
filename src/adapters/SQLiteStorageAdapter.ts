import { StorageAdapter, StorageAdapterOptions } from '../StorageAdapter';
import { ConnectionStatus } from '../ConnectionStatus';
import { Logger } from '../Logger';
import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';

interface SQLiteConfig {
  databasePath: string;
  tableName?: string;
  logger?: Logger;
}

interface CacheRow {
  key: string;
  value: string;
  created_at?: number;
  expires_at?: number | null;
  lock_owner?: string | null;
  lock_expires_at?: number | null;
}

interface LockRow {
  lock_owner?: string | null;
  lock_expires_at?: number | null;
}

export class SQLiteStorageAdapter implements StorageAdapter {
  private databasePath: string;
  private tableName: string;
  private logger: Logger;
  private db: Database | null = null; 
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

  constructor(config: SQLiteConfig) {
    this.databasePath = config.databasePath;
    this.tableName = config.tableName || 'cache_items';
    this.logger = config.logger || console;
    
    this.logger.info(`Initializing SQLite adapter with database: ${this.databasePath}`);
  }

  async initialize(): Promise<void> {
    try {
      this.db = await open({ filename: this.databasePath, driver: sqlite3.Database });

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS cache_items (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER,
          lock_owner TEXT,
          lock_expires_at INTEGER
        )
      `);

      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_expires_at ON cache_items(expires_at);
      `);

      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_expires_at ON ${this.tableName}(expires_at);
        CREATE INDEX IF NOT EXISTS idx_lock_expires_at ON ${this.tableName}(lock_expires_at);
      `);

      this.connectionStatus = ConnectionStatus.CONNECTED;
      this.logger.info('SQLite adapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize SQLite adapter', error);
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
      if (!this.db) throw new Error('Database not initialized');
      const now = Date.now();
      const expiresAt = expiresIn ? now + expiresIn : null;
      
      await this.db.run(
        `INSERT OR REPLACE INTO ${this.tableName} (key, value, created_at, expires_at) VALUES (?, ?, ?, ?)`,
        [key, value, now, expiresAt]
      );

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
      if (!this.db) throw new Error('Database not initialized');
      const now = Date.now();
      
      for (const [key, value] of values.entries()) {
        await this.db.run(
          `INSERT OR REPLACE INTO ${this.tableName} (key, value, created_at) VALUES (?, ?, ?)`,
          [key, value, now]
        );
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
      if (!this.db) throw new Error('Database not initialized');
      const row = await this.db.get<CacheRow>(
        `SELECT key, value, expires_at FROM ${this.tableName} WHERE key = ?`,
        [key]
      );

      if (!row) {
        return null;
      }

      if (row.expires_at && row.expires_at < Date.now()) {
        await this.del(key);
        return null;
      }

      return row.value;
    } catch (error) {
      this.logger.error(`Failed to get item with key: ${key}`, error);
      return null;
    }
  }

  public async mget(keys: string[]): Promise<(string | null)[]> {
    try {
      if (!this.db) throw new Error('Database not initialized');
      const results: (string | null)[] = [];
      const now = Date.now();

      for (const key of keys) {
        const row = await this.db.get<CacheRow>(
          `SELECT value, expires_at FROM ${this.tableName} WHERE key = ?`,
          [key]
        );

        if (!row) {
          results.push(null);
          continue;
        }

        if (row.expires_at && row.expires_at < now) {
          await this.del(key);
          results.push(null);
          continue;
        }

        results.push(row.value);
      }

      return results;
    } catch (error) {
      this.logger.error('Failed to get multiple items', error);
      return keys.map(() => null);
    }
  }

  public async del(key: string): Promise<boolean> {
    try {
      if (!this.db) throw new Error('Database not initialized');
      const result = await this.db.run(
        `DELETE FROM ${this.tableName} WHERE key = ?`,
        [key]
      );

      if (result && typeof result.changes === 'number' && result.changes > 0) {
        this.logger.trace(`Deleted item with key: ${key}`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Failed to delete item with key: ${key}`, error);
      return false;
    }
  }

  public async acquireLock(key: string, lockExpireTimeout?: number): Promise<boolean> {
    try {
      if (!this.db) throw new Error('Database not initialized');
      const now = Date.now();
      const lockExpiresAt = now + (lockExpireTimeout || 20000);

      const result = await this.db.run(
        `UPDATE ${this.tableName} SET lock_owner = ?, lock_expires_at = ? 
         WHERE key = ? AND (lock_owner IS NULL OR lock_expires_at < ?)`,
        ['lock_owner', lockExpiresAt, key, now]
      );

      const acquired = result && typeof result.changes === 'number' && result.changes > 0;
      
      if (acquired) {
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
      if (!this.db) throw new Error('Database not initialized');
      const result = await this.db.run(
        `UPDATE ${this.tableName} SET lock_owner = NULL, lock_expires_at = NULL 
         WHERE key = ? AND lock_owner IS NOT NULL`,
        [key]
      );

      const released = result && typeof result.changes === 'number' && result.changes > 0;
      
      if (released) {
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
      if (!this.db) throw new Error('Database not initialized');
      const row = await this.db.get<LockRow>(
        `SELECT lock_owner, lock_expires_at FROM ${this.tableName} WHERE key = ?`,
        [key]
      );

      if (!row || !row.lock_owner) {
        return false;
      }

      if (row.lock_expires_at && row.lock_expires_at < Date.now()) {
        await this.db.run(
          `UPDATE ${this.tableName} SET lock_owner = NULL, lock_expires_at = NULL WHERE key = ?`,
          [key]
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to check lock for key: ${key}`, error);
      return false;
    }
  }

  public setOptions?(options: StorageAdapterOptions): void {
  }

  public async cleanup(): Promise<void> {
    try {
      if (!this.db) throw new Error('Database not initialized');
      const now = Date.now();
      
      const expiredResult = await this.db.run(
        `DELETE FROM ${this.tableName} WHERE expires_at IS NOT NULL AND expires_at < ?`,
        [now]
      );

      const lockResult = await this.db.run(
        `UPDATE ${this.tableName} SET lock_owner = NULL, lock_expires_at = NULL 
         WHERE lock_expires_at IS NOT NULL AND lock_expires_at < ?`,
        [now]
      );

      this.logger.info(`Cleanup completed: ${expiredResult && typeof expiredResult.changes === 'number' ? expiredResult.changes : 0} expired items removed, ${lockResult && typeof lockResult.changes === 'number' ? lockResult.changes : 0} expired locks cleared`);
    } catch (error) {
      this.logger.error('Failed to cleanup SQLite storage', error);
      throw error;
    }
  }

  public async close(): Promise<void> {
    try {
      if (this.db) {
        await this.db.close();
        this.connectionStatus = ConnectionStatus.DISCONNECTED;
        this.logger.info('SQLite adapter closed successfully');
      }
    } catch (error) {
      this.logger.error('Failed to close SQLite adapter', error);
      throw error;
    }
  }
} 