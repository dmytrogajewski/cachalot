import { BaseManager, ManagerOptions } from "./BaseManager";
import { Executor, ExecutorContext, runExecutor } from "../Executor";
import { WriteOptions, ReadWriteOptions } from "../storage/Storage";
import { Record } from "../storage/Record";
import { BloomFilter } from "../BloomFilter";
import deserialize from "../deserialize";

export const DEFAULT_REFRESH_AHEAD_FACTOR = 0.8;

export interface RefreshAheadManagerOptions extends ManagerOptions {
  refreshAheadFactor?: number;
}

class RefreshAheadManager extends BaseManager {
  private bloomFilter: BloomFilter | null = null;
  private readonly refreshAheadFactor: number;

  public static getName(): string {
    return "refresh-ahead";
  }

  constructor(options: RefreshAheadManagerOptions) {
    super(options);

    this.refreshAheadFactor = options.refreshAheadFactor || DEFAULT_REFRESH_AHEAD_FACTOR;

    if (isFinite(Number(this.refreshAheadFactor))) {
      if (this.refreshAheadFactor <= 0) {
        throw new Error("Refresh-Ahead factor should be more than 0");
      }

      if (this.refreshAheadFactor >= 1) {
        throw new Error("Refresh-Ahead factor should be under 1");
      }
    }

    if (options.enableBloomFilter && options.bloomFilterOptions) {
      this.bloomFilter = new BloomFilter({
        expectedElements: options.bloomFilterOptions.expectedElements || 10000,
        falsePositiveRate: options.bloomFilterOptions.falsePositiveRate || 0.01,
        logger: this.logger,
      });
      this.logger.info("RefreshAheadManager initialized with Bloom filter");
    }
  }

  public async get<R>(key: string, executor: Executor<R>, options: ReadWriteOptions<R> = {}): Promise<R> {
    if (this.bloomFilter) {
      const mightExist = this.bloomFilter.mightContain(key);
      
      if (!mightExist) {
        this.logger.trace(`Bloom filter indicates key "${key}" definitely doesn't exist, running executor directly`);
        return runExecutor(executor);
      }
      
      this.logger.trace(`Bloom filter indicates key "${key}" might exist, checking storage`);
    }

    let record: Record<string> | null = null;

    try {
      record = await this.storage.get(key);
    } catch (e) {
      this.logger.error("Failed to get value from storage, falling back to executor", e);

      return runExecutor(executor);
    }

    const executorContext = { key, executor, options };

    if (this.isRecordValid(record) && !(await this.storage.isOutdated(record))) {
      const result = deserialize<R>(record.value);

      if (this.bloomFilter) {
        this.bloomFilter.add(key);
      }

      if (this.isRecordExpireSoon(record)) {
        this.refresh(key, executorContext, options).catch((err) => this.logger.error(err));
      }

      return result;
    }

    return this.updateCacheAndGetResult(executorContext, options);
  }

  public async set<R>(key: string, value: R, options?: WriteOptions<R>): Promise<Record<R>> {
    const record = await this.storage.set(key, value, options);
    
    if (this.bloomFilter) {
      this.bloomFilter.add(key);
    }
    
    return record;
  }

  private isRecordValid<R>(record: Record<R> | null | void): record is Record<R> {
    const currentDate: number = Date.now();

    if (!record) {
      return false;
    }

    const recordExpireDate = Number(record.createdAt + record.expiresIn) || 0;
    const isExpired = !record.permanent && currentDate > recordExpireDate;

    if (isExpired) {
      return false;
    }

    return record.value !== undefined;
  }

  private isRecordExpireSoon<R>(record: Record<R> | null): boolean {
    const currentDate: number = Date.now();

    if (!record) {
      return false;
    }

    const recordExpireDate = Number(record.createdAt + record.expiresIn * this.refreshAheadFactor) || 0;

    return !record.permanent && currentDate > recordExpireDate;
  }

  private async refresh<R>(
    key: string,
    context: ExecutorContext<R>,
    options: WriteOptions<R>
  ): Promise<void> {
    const refreshAheadKey = `refreshAhead:${key}`;
    const isExecutorLockSuccessful = await this.storage.lockKey(refreshAheadKey);

    if (isExecutorLockSuccessful) {
      try {
        this.logger.trace(`refresh "${key}"`);

        const executorResult = await runExecutor(context.executor);

        await this.storage.set(key, executorResult, options);
      } catch (e) {
        this.logger.error(e);
      } finally {
        await this.storage.releaseKey(refreshAheadKey);
      }
    }
  }
}

export default RefreshAheadManager;
