import { promises as fs } from "fs";
import * as path from "path";
import { ConnectionStatus } from "../ConnectionStatus";
import { StorageAdapter } from "../StorageAdapter";

export type FilesystemStorageAdapterOptions = {
  dir: string; // Directory to store cache files
  operationTimeout?: number;
  lockExpireTimeout?: number;
};

const DEFAULT_OPERATION_TIMEOUT = 150;
const DEFAULT_LOCK_EXPIRES = 20000;

interface CacheFile {
  value: string;
  expiresAt: number | undefined;
  createdAt: number;
}

export class FilesystemStorageAdapter implements StorageAdapter {
  private connectionStatus: ConnectionStatus = ConnectionStatus.CONNECTED;
  private options: Required<FilesystemStorageAdapterOptions>;

  constructor(options: FilesystemStorageAdapterOptions) {
    if (!options.dir) throw new Error("FilesystemStorageAdapter: 'dir' option is required");
    this.options = {
      operationTimeout: DEFAULT_OPERATION_TIMEOUT,
      lockExpireTimeout: DEFAULT_LOCK_EXPIRES,
      ...options,
    };
  }

  private getFilePath(key: string): string {
    // Sanitize key for filesystem
    const safeKey = encodeURIComponent(key);
    return path.join(this.options.dir, safeKey + ".json");
  }

  private getLockFilePath(key: string): string {
    const safeKey = encodeURIComponent(key);
    return path.join(this.options.dir, safeKey + ".lock.json");
  }

  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  public onConnect(callback: (...args: unknown[]) => void): void {
    setImmediate(callback);
  }

  public async set(key: string, value: string, expiresIn?: number): Promise<boolean> {
    const filePath = this.getFilePath(key);
    const expiresAt = expiresIn ? Date.now() + expiresIn : undefined;
    const cacheFile: CacheFile = {
      value,
      expiresAt,
      createdAt: Date.now(),
    };
    try {
      await fs.mkdir(this.options.dir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(cacheFile), "utf8");
      return true;
    } catch (err) {
      return false;
    }
  }

  public async mset(values: Map<string, string>): Promise<void> {
    await fs.mkdir(this.options.dir, { recursive: true });
    const now = Date.now();
    const promises = Array.from(values.entries()).map(([key, value]) => {
      const filePath = this.getFilePath(key);
      const cacheFile: CacheFile = {
        value,
        expiresAt: undefined,
        createdAt: now,
      };
      return fs.writeFile(filePath, JSON.stringify(cacheFile), "utf8");
    });
    await Promise.all(promises);
  }

  public async get(key: string): Promise<string | null> {
    const filePath = this.getFilePath(key);
    try {
      const data = await fs.readFile(filePath, "utf8");
      const cacheFile: CacheFile = JSON.parse(data);
      if (cacheFile.expiresAt && Date.now() > cacheFile.expiresAt) {
        await fs.unlink(filePath);
        return null;
      }
      return cacheFile.value;
    } catch (err) {
      return null;
    }
  }

  public async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((key) => this.get(key)));
  }

  public async del(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      return false;
    }
  }

  public async acquireLock(key: string, lockExpireTimeout?: number): Promise<boolean> {
    const lockFilePath = this.getLockFilePath(key);
    const expiresAt = Date.now() + (lockExpireTimeout || this.options.lockExpireTimeout);
    const lockData = { expiresAt, createdAt: Date.now() };
    try {
      await fs.mkdir(this.options.dir, { recursive: true });
      // Use O_EXCL to fail if file exists
      await fs.writeFile(lockFilePath, JSON.stringify(lockData), { flag: "wx" });
      return true;
    } catch (err) {
      // If file exists, check if expired
      try {
        const data = await fs.readFile(lockFilePath, "utf8");
        const lock = JSON.parse(data);
        if (lock.expiresAt && Date.now() > lock.expiresAt) {
          await fs.unlink(lockFilePath);
          // Try to acquire again
          await fs.writeFile(lockFilePath, JSON.stringify(lockData), { flag: "wx" });
          return true;
        }
      } catch {}
      return false;
    }
  }

  public async releaseLock(key: string): Promise<boolean> {
    const lockFilePath = this.getLockFilePath(key);
    try {
      await fs.unlink(lockFilePath);
      return true;
    } catch (err) {
      return false;
    }
  }

  public async isLockExists(key: string): Promise<boolean> {
    const lockFilePath = this.getLockFilePath(key);
    try {
      const data = await fs.readFile(lockFilePath, "utf8");
      const lock = JSON.parse(data);
      if (lock.expiresAt && Date.now() > lock.expiresAt) {
        await fs.unlink(lockFilePath);
        return false;
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  public setOptions(): void {
    // No-op for filesystem adapter
  }
}

export default FilesystemStorageAdapter; 