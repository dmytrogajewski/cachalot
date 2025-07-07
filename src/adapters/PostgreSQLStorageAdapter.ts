import { ConnectionStatus } from "../ConnectionStatus";
import { StorageAdapter } from "../StorageAdapter";
import { withTimeout } from "../with-timeout";

export const DEFAULT_OPERATION_TIMEOUT = 150;
export const DEFAULT_LOCK_EXPIRES = 20000;

export type PostgreSQLStorageAdapterOptions = {
  operationTimeout?: number;
  lockExpireTimeout?: number;
  tableName?: string;
  createTableIfNotExists?: boolean;
};

const DEFAULT_TABLE_NAME = "cache";

interface PostgreSQLClient {
  query(text: string, values?: any[]): Promise<{ rows: any[]; rowCount: number }>;
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: string, callback: (...args: any[]) => void): void;
}

/**
 * PostgreSQL adapter for Manager. Implements the StorageAdapter interface
 * and automatically creates the cache table if it doesn't exist.
 */
export class PostgreSQLStorageAdapter implements StorageAdapter {
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private options: Required<PostgreSQLStorageAdapterOptions>;
  private readonly withTimeout: <T>(promise: Promise<T>) => Promise<T>;

  constructor(
    private client: PostgreSQLClient,
    options?: PostgreSQLStorageAdapterOptions
  ) {
    this.options = {
      operationTimeout: DEFAULT_OPERATION_TIMEOUT,
      lockExpireTimeout: DEFAULT_LOCK_EXPIRES,
      tableName: DEFAULT_TABLE_NAME,
      createTableIfNotExists: true,
      ...options,
    };

    this.withTimeout = <T>(promise: Promise<T>) =>
      withTimeout(promise, this.options.operationTimeout);

    this.setupConnectionHandlers();
    this.initializeTable();
  }

  /**
   * Sets up connection event handlers
   */
  private setupConnectionHandlers(): void {
    this.client.on("connect", () => {
      this.connectionStatus = ConnectionStatus.CONNECTED;
    });

    this.client.on("error", () => {
      this.connectionStatus = ConnectionStatus.DISCONNECTED;
    });

    this.client.on("end", () => {
      this.connectionStatus = ConnectionStatus.DISCONNECTED;
    });
  }

  /**
   * Initializes the cache table if it doesn't exist
   */
  private async initializeTable(): Promise<void> {
    if (!this.options.createTableIfNotExists) return;

    try {
      await this.withTimeout(
        this.client.query(`
          CREATE TABLE IF NOT EXISTS ${this.options.tableName} (
            cache_key VARCHAR(255) PRIMARY KEY,
            cache_value TEXT NOT NULL,
            expires_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `)
      );

      // Create index on expires_at for efficient cleanup
      await this.withTimeout(
        this.client.query(`
          CREATE INDEX IF NOT EXISTS idx_${this.options.tableName}_expires_at 
          ON ${this.options.tableName} (expires_at)
        `)
      );

      // Create index on updated_at for LRU eviction
      await this.withTimeout(
        this.client.query(`
          CREATE INDEX IF NOT EXISTS idx_${this.options.tableName}_updated_at 
          ON ${this.options.tableName} (updated_at)
        `)
      );
    } catch (error) {
      console.warn("Failed to initialize cache table:", error);
    }
  }

  /**
   * Returns the current connection status
   */
  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Calls the callback when the database is ready
   */
  public onConnect(callback: (...args: unknown[]) => void): void {
    this.client.on("connect", callback);
  }

  /**
   * Sets a value in the PostgreSQL cache
   */
  public async set(key: string, value: string, expiresIn?: number): Promise<boolean> {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn) : null;

    try {
      await this.withTimeout(
        this.client.query(
          `INSERT INTO ${this.options.tableName} (cache_key, cache_value, expires_at, updated_at) 
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
           ON CONFLICT (cache_key) DO UPDATE SET 
             cache_value = EXCLUDED.cache_value, 
             expires_at = EXCLUDED.expires_at, 
             updated_at = CURRENT_TIMESTAMP`,
          [key, value, expiresAt]
        )
      );

      return true;
    } catch (error) {
      console.error("PostgreSQL set error:", error);
      return false;
    }
  }

  /**
   * Sets multiple values in the PostgreSQL cache
   */
  public async mset(values: Map<string, string>): Promise<void> {
    if (values.size === 0) return;

    const entries = Array.from(values.entries());
    const placeholders: string[] = [];
    const valuesArray: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of entries) {
      placeholders.push(`($${paramIndex}, $${paramIndex + 1}, CURRENT_TIMESTAMP)`);
      valuesArray.push(key, value);
      paramIndex += 2;
    }

    try {
      await this.withTimeout(
        this.client.query(
          `INSERT INTO ${this.options.tableName} (cache_key, cache_value, updated_at) 
           VALUES ${placeholders.join(", ")} 
           ON CONFLICT (cache_key) DO UPDATE SET 
             cache_value = EXCLUDED.cache_value, 
             updated_at = CURRENT_TIMESTAMP`,
          valuesArray
        )
      );
    } catch (error) {
      console.error("PostgreSQL mset error:", error);
      throw error;
    }
  }

  /**
   * Gets a value from the PostgreSQL cache
   */
  public async get(key: string): Promise<string | null> {
    try {
      const result = await this.withTimeout(
        this.client.query(
          `SELECT cache_value FROM ${this.options.tableName} 
           WHERE cache_key = $1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
          [key]
        )
      );

      return result.rows[0]?.cache_value || null;
    } catch (error) {
      console.error("PostgreSQL get error:", error);
      return null;
    }
  }

  /**
   * Gets multiple values from the PostgreSQL cache
   */
  public async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];

    const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");

    try {
      const result = await this.withTimeout(
        this.client.query(
          `SELECT cache_key, cache_value FROM ${this.options.tableName} 
           WHERE cache_key IN (${placeholders}) AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
          keys
        )
      );

      // Create a map of found values
      const valueMap = new Map(
        result.rows.map((row) => [row.cache_key, row.cache_value])
      );

      // Return values in the same order as requested keys
      return keys.map((key) => valueMap.get(key) || null);
    } catch (error) {
      console.error("PostgreSQL mget error:", error);
      return keys.map(() => null);
    }
  }

  /**
   * Deletes a value from the PostgreSQL cache
   */
  public async del(key: string): Promise<boolean> {
    try {
      const result = await this.withTimeout(
        this.client.query(
          `DELETE FROM ${this.options.tableName} WHERE cache_key = $1`,
          [key]
        )
      );

      return result.rowCount > 0;
    } catch (error) {
      console.error("PostgreSQL del error:", error);
      return false;
    }
  }

  /**
   * Acquires a lock on a key using PostgreSQL
   */
  public async acquireLock(key: string, lockExpireTimeout?: number): Promise<boolean> {
    const lockKey = `${key}_lock`;
    const expiresAt = new Date(
      Date.now() + (lockExpireTimeout || this.options.lockExpireTimeout)
    );

    try {
      const result = await this.withTimeout(
        this.client.query(
          `INSERT INTO ${this.options.tableName} (cache_key, cache_value, expires_at, updated_at) 
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
           ON CONFLICT (cache_key) DO NOTHING`,
          [lockKey, "locked", expiresAt]
        )
      );

      return result.rowCount > 0;
    } catch (error) {
      console.error("PostgreSQL acquireLock error:", error);
      return false;
    }
  }

  /**
   * Releases a lock on a key
   */
  public async releaseLock(key: string): Promise<boolean> {
    const lockKey = `${key}_lock`;

    try {
      const result = await this.withTimeout(
        this.client.query(
          `DELETE FROM ${this.options.tableName} WHERE cache_key = $1`,
          [lockKey]
        )
      );

      return result.rowCount > 0;
    } catch (error) {
      console.error("PostgreSQL releaseLock error:", error);
      return false;
    }
  }

  /**
   * Checks if a key is locked
   */
  public async isLockExists(key: string): Promise<boolean> {
    const lockKey = `${key}_lock`;

    try {
      const result = await this.withTimeout(
        this.client.query(
          `SELECT 1 FROM ${this.options.tableName} 
           WHERE cache_key = $1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
          [lockKey]
        )
      );

      return result.rowCount > 0;
    } catch (error) {
      console.error("PostgreSQL isLockExists error:", error);
      return false;
    }
  }

  /**
   * Sets options (no-op for PostgreSQL adapter)
   */
  public setOptions(): void {
    // No-op for PostgreSQL adapter
  }

  /**
   * Cleans up expired items from the cache
   */
  public async cleanup(): Promise<number> {
    try {
      const result = await this.withTimeout(
        this.client.query(
          `DELETE FROM ${this.options.tableName} 
           WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`
        )
      );

      return result.rowCount;
    } catch (error) {
      console.error("PostgreSQL cleanup error:", error);
      return 0;
    }
  }

  /**
   * Gets cache statistics
   */
  public async getStats(): Promise<{
    totalItems: number;
    expiredItems: number;
    locks: number;
  }> {
    try {
      const [totalResult, expiredResult, locksResult] = await Promise.all([
        this.withTimeout(
          this.client.query(`SELECT COUNT(*) as count FROM ${this.options.tableName}`)
        ),
        this.withTimeout(
          this.client.query(
            `SELECT COUNT(*) as count FROM ${this.options.tableName} 
             WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`
          )
        ),
        this.withTimeout(
          this.client.query(
            `SELECT COUNT(*) as count FROM ${this.options.tableName} 
             WHERE cache_key LIKE '%_lock'`
          )
        ),
      ]);

      return {
        totalItems: parseInt(totalResult.rows[0].count),
        expiredItems: parseInt(expiredResult.rows[0].count),
        locks: parseInt(locksResult.rows[0].count),
      };
    } catch (error) {
      console.error("PostgreSQL getStats error:", error);
      return { totalItems: 0, expiredItems: 0, locks: 0 };
    }
  }
}

export default PostgreSQLStorageAdapter; 