import { BaseManager, ManagerOptions } from "./BaseManager";
import { Executor, runExecutor } from "../Executor";
import { WriteOptions, ReadWriteOptions, Tag } from "../storage/Storage";
import { Record } from "../storage/Record";
import { BloomFilter } from "../BloomFilter";
import deserialize from "../deserialize";

import { StorageAdapter } from "../StorageAdapter";

export interface CacheLevel {
  name: string;
  storage: StorageAdapter;
  priority: number;
  ttl?: number;
  enabled: boolean;
}

export interface MultiLevelManagerOptions extends ManagerOptions {
  levels: CacheLevel[];
  fallbackStrategy?: 'executor' | 'next-level' | 'fail';
  enableBloomFilter?: boolean;
  bloomFilterOptions?: {
    expectedElements?: number;
    falsePositiveRate?: number;
  };
}

export const DEFAULT_MULTI_LEVEL_OPTIONS = {
  fallbackStrategy: 'executor' as const,
  enableBloomFilter: false,
  bloomFilterOptions: {
    expectedElements: 10000,
    falsePositiveRate: 0.01,
  },
};

class MultiLevelManager extends BaseManager {
  private bloomFilter: BloomFilter | null = null;
  private levels: CacheLevel[] = [];
  private metrics: { [key: string]: {
    hits: number;
    misses: number;
    sets: number;
    dels: number;
  } } = {};

  public static getName(): string {
    return "multi-level";
  }

  private options: MultiLevelManagerOptions;

  constructor(options: MultiLevelManagerOptions) {
    super(options);
    this.options = options;
    
    this.levels = [...options.levels].sort((a, b) => a.priority - b.priority);
    
    if (options.enableBloomFilter && options.bloomFilterOptions) {
      this.bloomFilter = new BloomFilter({
        expectedElements: options.bloomFilterOptions.expectedElements || 10000,
        falsePositiveRate: options.bloomFilterOptions.falsePositiveRate || 0.01,
        logger: this.logger,
      });
      this.logger.info("MultiLevelManager initialized with Bloom filter");
    }

    for (const level of this.levels) {
      this.metrics[level.name] = { hits: 0, misses: 0, sets: 0, dels: 0 };
    }

    this.logger.info(`MultiLevelManager initialized with ${this.levels.length} levels`);
  }

  public async get<R>(key: string, executor: Executor<R>, options: ReadWriteOptions<R> = {}): Promise<R> {
    if (this.bloomFilter) {
      const mightExist = this.bloomFilter.mightContain(key);
      
      if (!mightExist) {
        this.logger.trace(`Bloom filter indicates key "${key}" definitely doesn't exist, running executor directly`);
        return runExecutor(executor);
      }
      
      this.logger.trace(`Bloom filter indicates key "${key}" might exist, checking cache levels`);
    }

    for (const level of this.levels) {
      if (!level.enabled) {
        this.logger.trace(`Skipping disabled level: ${level.name}`);
        continue;
      }

      try {
        this.logger.trace(`Checking level: ${level.name} for key: ${key}`);
        
        const serializedValue = await level.storage.get(key);
        
        if (serializedValue) {
          this.logger.trace(`Hit in level: ${level.name} for key: ${key}`);
          this.metrics[level.name].hits++;
          const result = deserialize<R>(serializedValue);
          
          if (this.bloomFilter && typeof key === 'string') {
            this.bloomFilter.add(key);
          }
          
          await this.populateHigherLevels(key, result, options);
          
          return result;
        } else {
          this.metrics[level.name].misses++;
        }
      } catch (error) {
        this.logger.warn(`Error accessing level ${level.name}:`, error);
        this.metrics[level.name].misses++;
        continue;
      }
    }

    this.logger.trace(`Cache miss for key: ${key}, using fallback strategy`);
    
    const fallbackStrategy = this.options.fallbackStrategy || 'executor';
    
    switch (fallbackStrategy) {
      case 'executor':
        return this.handleExecutorFallback(key, executor, options);
      case 'next-level':
        return this.handleNextLevelFallback(key, executor, options);
      case 'fail':
        throw new Error(`Cache miss for key: ${key}`);
      default:
        return this.handleExecutorFallback(key, executor, options);
    }
  }

  public async set<R>(key: string, value: R, options?: WriteOptions<R>): Promise<Record<R>> {
    const serializedValue = JSON.stringify(value);
    let usedExpiresIn = 0;
    const now = Date.now();
    
    for (const level of this.levels) {
      if (!level.enabled) {
        continue;
      }

      try {
        const expiresIn = level.ttl ?? options?.expiresIn ?? 0;
        if (!usedExpiresIn) usedExpiresIn = expiresIn;
        const success = await level.storage.set(key, serializedValue, expiresIn);
        if (success) {
          this.metrics[level.name].sets++;
          this.logger.trace(`Successfully set key: ${key} in level: ${level.name}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to set key: ${key} in level: ${level.name}:`, error);
      }
    }
    
    if (this.bloomFilter) {
      this.bloomFilter.add(key as string);
    }
    
    const tags: Tag[] = [];
    if (options?.tags) {
      const tagNames = typeof options.tags === 'function' ? options.tags() : options.tags;
      tags.push(...tagNames.map(name => ({ name, version: now })));
    }
    
    const record = new Record<R>(key, value, tags, { ...options, expiresIn: usedExpiresIn });
    
    return record;
  }

  public override async del(key: string): Promise<boolean> {
    let success = false;
    
    for (const level of this.levels) {
      if (!level.enabled) {
        continue;
      }

      try {
        const result = await level.storage.del(key);
        if (result) {
          success = true;
          this.metrics[level.name].dels++;
        }
        this.logger.trace(`Deleted key: ${key} from level: ${level.name}`);
      } catch (error) {
        this.logger.warn(`Failed to delete key: ${key} from level: ${level.name}:`, error);
      }
    }
    
    return success;
  }

  private async handleExecutorFallback<R>(
    key: string, 
    executor: Executor<R>, 
    options: ReadWriteOptions<R>
  ): Promise<R> {
    this.logger.trace(`Running executor for key: ${key}`);
    const result = await runExecutor(executor);
    
    await this.set(key, result, options);
    
    return result;
  }

  private async handleNextLevelFallback<R>(
    key: string, 
    executor: Executor<R>, 
    options: ReadWriteOptions<R>
  ): Promise<R> {
    this.logger.trace(`Trying next level fallback for key: ${key}`);
    return this.handleExecutorFallback(key, executor, options);
  }

  private async populateHigherLevels<R>(
    key: string, 
    value: R, 
    options: WriteOptions<R>
  ): Promise<void> {
    const foundLevelIndex = this.levels.findIndex(level => level.enabled);
    
    if (foundLevelIndex <= 0) {
      return;
    }
    
    for (let i = 0; i < foundLevelIndex; i++) {
      const level = this.levels[i];
      if (!level.enabled) {
        continue;
      }
      
      try {
        const levelOptions = { ...options };
        if (level.ttl) {
          levelOptions.expiresIn = level.ttl;
        }
        
        const serializedValue = JSON.stringify(value);
        await level.storage.set(key, serializedValue, levelOptions.expiresIn);
        this.logger.trace(`Warmed level: ${level.name} with key: ${key}`);
      } catch (error) {
        this.logger.warn(`Failed to warm level: ${level.name} with key: ${key}:`, error);
      }
    }
  }

  public getLevels(): CacheLevel[] {
    return [...this.levels];
  }

  public enableLevel(levelName: string): void {
    const level = this.levels.find(l => l.name === levelName);
    if (level) {
      level.enabled = true;
      this.logger.info(`Enabled level: ${levelName}`);
    }
  }

  public disableLevel(levelName: string): void {
    const level = this.levels.find(l => l.name === levelName);
    if (level) {
      level.enabled = false;
      this.logger.info(`Disabled level: ${levelName}`);
    }
  }

  public getLevelStats(): Array<{ name: string; enabled: boolean; priority: number }> {
    return this.levels.map(level => ({
      name: level.name,
      enabled: level.enabled,
      priority: level.priority,
    }));
  }

  public getMetrics() {
    return JSON.parse(JSON.stringify(this.metrics));
  }
}

export default MultiLevelManager; 