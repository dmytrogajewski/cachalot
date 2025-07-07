import { ConnectionStatus } from "../ConnectionStatus";
import { StorageAdapter } from "../StorageAdapter";
import { withTimeout } from "../with-timeout";

export const DEFAULT_OPERATION_TIMEOUT = 150;
export const DEFAULT_LOCK_EXPIRES = 20000;

export type MongoDBStorageAdapterOptions = {
  operationTimeout?: number;
  lockExpireTimeout?: number;
  collectionName?: string;
  createIndexes?: boolean;
};

const DEFAULT_COLLECTION_NAME = "cache";

interface MongoDBUpdateResult {
  upsertedCount?: number;
  modifiedCount?: number;
  deletedCount?: number;
}

interface MongoDBDeleteResult {
  deletedCount?: number;
}

interface MongoDBDocument {
  _id: string;
  value: string;
  expiresAt?: Date;
  updatedAt: Date;
}

interface MongoDBCollection<T> {
  findOne(filter: any, options?: any): Promise<T | null>; 
  find(filter: any, options?: any): Promise<MongoDBCursor<T>>;
  insertOne(doc: T): Promise<T>;
  updateOne(filter: any, update: any, options?: any): Promise<MongoDBUpdateResult | null>;
  deleteOne(filter: any): Promise<MongoDBDeleteResult | null>;
  deleteMany(filter: any): Promise<MongoDBDeleteResult | null>;
  createIndex(keys: any, options?: any): Promise<T | null>;
  countDocuments(filter?: any): Promise<number>;
  bulkWrite(operations: any[]): Promise<T | null>;
}

interface MongoDBCursor<T> {
  toArray(): Promise<T[]>;
}

interface MongoDBClient {
  collection<T>(name: string): MongoDBCollection<T>;
  on(event: string, callback: (...args: any[]) => void): void;
  close(): Promise<void>;
}

/**
 * MongoDB adapter for Manager. Implements the StorageAdapter interface
 * and automatically creates indexes for efficient querying.
 */
export class MongoDBStorageAdapter implements StorageAdapter {
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private options: Required<MongoDBStorageAdapterOptions>;
  private readonly withTimeout: <T>(promise: Promise<T>) => Promise<T>;

  constructor(
    private client: MongoDBClient,
    options?: MongoDBStorageAdapterOptions
  ) {
    this.options = {
      operationTimeout: DEFAULT_OPERATION_TIMEOUT,
      lockExpireTimeout: DEFAULT_LOCK_EXPIRES,
      collectionName: DEFAULT_COLLECTION_NAME,
      createIndexes: true,
      ...options,
    };

    this.withTimeout = <T>(promise: Promise<T>) =>
      withTimeout(promise, this.options.operationTimeout);

    this.setupConnectionHandlers();
    this.initializeIndexes();
  }

  /**
   * Gets the MongoDB collection for cache operations
   */
  private getCollection<T>(): MongoDBCollection<T> {
    return this.client.collection(this.options.collectionName);
  }

  /**
   * Sets up connection event handlers
   */
  private setupConnectionHandlers(): void {
    this.client.on("connected", () => {
      this.connectionStatus = ConnectionStatus.CONNECTED;
    });

    this.client.on("error", () => {
      this.connectionStatus = ConnectionStatus.DISCONNECTED;
    });

    this.client.on("disconnected", () => {
      this.connectionStatus = ConnectionStatus.DISCONNECTED;
    });
  }

  /**
   * Initializes indexes for efficient querying
   */
  private async initializeIndexes(): Promise<void> {
    if (!this.options.createIndexes) return;

    try {
      const collection = this.getCollection();

      await this.withTimeout(
        collection.createIndex({ expiresAt: 1 }, { background: true })
      );

      await this.withTimeout(
        collection.createIndex({ updatedAt: 1 }, { background: true })
      );

      await this.withTimeout(
        collection.createIndex({ _id: 1 }, { unique: true, background: true })
      );

      await this.withTimeout(
        collection.createIndex(
          { expiresAt: 1 },
          { expireAfterSeconds: 0, background: true }
        )
      );
    } catch (error) {
      console.warn("Failed to initialize MongoDB indexes:", error);
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
    this.client.on("connected", callback);
  }

  /**
   * Sets a value in the MongoDB cache
   */
  public async set(key: string, value: string, expiresIn?: number): Promise<boolean> {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn) : null;

    try {
      await this.withTimeout(
        this.getCollection().updateOne(
          { _id: key },
          {
            $set: {
              value,
              expiresAt,
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        )
      );

      return true;
    } catch (error) {
      console.error("MongoDB set error:", error);
      return false;
    }
  }

  /**
   * Sets multiple values in the MongoDB cache
   */
  public async mset(values: Map<string, string>): Promise<void> {
    if (values.size === 0) return;

    try {
      const operations = Array.from(values.entries()).map(([key, value]) => ({
        updateOne: {
          filter: { _id: key },
          update: {
            $set: {
              value,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      }));

      await this.withTimeout(this.getCollection().bulkWrite(operations));
    } catch (error) {
      console.error("MongoDB mset error:", error);
      throw error;
    }
  }

  /**
   * Gets a value from the MongoDB cache
   */
  public async get(key: string): Promise<string | null> {
    try {
      const doc = await this.withTimeout(
        this.getCollection<MongoDBDocument>().findOne({
          _id: key,
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: new Date() } },
          ],
        })
      );

      return doc?.value || null;
    } catch (error) {
      console.error("MongoDB get error:", error);
      return null;
    }
  }

  /**
   * Gets multiple values from the MongoDB cache
   */
  public async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];

    try {
      const cursor = await this.getCollection<MongoDBDocument>().find({
        _id: { $in: keys },
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ],
      });

      const docs = await this.withTimeout(cursor.toArray());

      const valueMap = new Map(docs.map((doc) => [doc._id, doc.value]));

      return keys.map((key) => valueMap.get(key) || null);
    } catch (error) {
      console.error("MongoDB mget error:", error);
      return keys.map(() => null);
    }
  }

  /**
   * Deletes a value from the MongoDB cache
   */
  public async del(key: string): Promise<boolean> {
    try {
      const result = await this.withTimeout(
        this.getCollection().deleteOne({ _id: key })
      );

      return (result?.deletedCount || 0) > 0;
    } catch (error) {
      console.error("MongoDB del error:", error);
      return false;
    }
  }

  /**
   * Acquires a lock on a key using MongoDB
   */
  public async acquireLock(key: string, lockExpireTimeout?: number): Promise<boolean> {
    const lockKey = `${key}_lock`;
    const expiresAt = new Date(
      Date.now() + (lockExpireTimeout || this.options.lockExpireTimeout)
    );

    try {
      const result = await this.withTimeout(
        this.getCollection().updateOne(
          { _id: lockKey },
          {
            $set: {
              value: "locked",
              expiresAt,
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        )
      );

      return (result?.upsertedCount || 0) > 0 || (result?.modifiedCount || 0) > 0;
    } catch (error) {
      console.error("MongoDB acquireLock error:", error);
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
        this.getCollection().deleteOne({ _id: lockKey })
      );

      return (result?.deletedCount || 0) > 0;
    } catch (error) {
      console.error("MongoDB releaseLock error:", error);
      return false;
    }
  }

  /**
   * Checks if a key is locked
   */
  public async isLockExists(key: string): Promise<boolean> {
    const lockKey = `${key}_lock`;

    try {
      const doc = await this.withTimeout(
        this.getCollection().findOne({
          _id: lockKey,
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: new Date() } },
          ],
        })
      );

      return !!doc;
    } catch (error) {
      console.error("MongoDB isLockExists error:", error);
      return false;
    }
  }

  /**
   * Sets options (no-op for MongoDB adapter)
   */
  public setOptions(): void {
    // No-op for MongoDB adapter
  }

  /**
   * Cleans up expired items from the cache
   */
  public async cleanup(): Promise<number> {
    try {
      const result = await this.withTimeout(
        this.getCollection().deleteMany({
          expiresAt: { $exists: true, $lte: new Date() },
        })
      );

      return result?.deletedCount || 0;
    } catch (error) {
      console.error("MongoDB cleanup error:", error);
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
      const collection = this.getCollection();
      const now = new Date();

      const [totalItems, expiredItems, locks] = await Promise.all([
        this.withTimeout(collection.countDocuments()),
        this.withTimeout(
          collection.countDocuments({
            expiresAt: { $exists: true, $lte: now },
          })
        ),
        this.withTimeout(
          collection.countDocuments({
            _id: { $regex: /_lock$/ },
            $or: [
              { expiresAt: { $exists: false } },
              { expiresAt: { $gt: now } },
            ],
          })
        ),
      ]);

      return {
        totalItems,
        expiredItems,
        locks,
      };
    } catch (error) {
      console.error("MongoDB getStats error:", error);
      return { totalItems: 0, expiredItems: 0, locks: 0 };
    }
  }
}

export default MongoDBStorageAdapter; 