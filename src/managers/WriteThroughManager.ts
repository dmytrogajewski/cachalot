import { BaseManager, ManagerOptions } from "./BaseManager";
import { Executor, runExecutor } from "../Executor";
import { ReadWriteOptions, WriteOptions } from "../storage/Storage";
import { Record } from "../storage/Record";
import { BloomFilter } from "../BloomFilter";
import deserialize from "../deserialize";

class WriteThroughManager extends BaseManager {
  private bloomFilter: BloomFilter | null = null;

  public static getName(): string {
    return "write-through";
  }

  constructor(options: ManagerOptions) {
    super(options);
    
    if (options.enableBloomFilter && options.bloomFilterOptions) {
      this.bloomFilter = new BloomFilter({
        expectedElements: options.bloomFilterOptions.expectedElements || 10000,
        falsePositiveRate: options.bloomFilterOptions.falsePositiveRate || 0.01,
        logger: this.logger,
      });
      this.logger.info("WriteThroughManager initialized with Bloom filter");
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

    if (this.isRecordValid(record)) {
      this.logger.trace("hit", key);

      const result = deserialize<R>(record.value);
      
      if (this.bloomFilter) {
        this.bloomFilter.add(key);
      }

      return result;
    }

    this.logger.trace("miss", key);

    const executorContext = { key, executor, options };
    return this.updateCacheAndGetResult(executorContext, options);
  }

  public async set<R>(key: string, value: R, options?: WriteOptions<R>): Promise<Record<R>> {
    const record = await this.storage.set(key, value, { ...options, permanent: true });
    
    if (this.bloomFilter) {
      this.bloomFilter.add(key);
    }
    
    return record;
  }

  private isRecordValid<R>(record: Record<R> | null | void): record is Record<R> {
    if (!record) {
      return false;
    }

    return record.value !== undefined;
  }
}

export default WriteThroughManager;
