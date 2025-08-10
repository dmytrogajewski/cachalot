import { StorageAdapter, StorageAdapterOptions } from "./StorageAdapter";
import { Tag, Tags } from "./storage/Storage";
import { Record } from "./storage/Record";
import Cache, { CacheOptions } from "./Cache";
import RedisStorageAdapter from "./adapters/RedisStorageAdapter";
import MemcachedStorageAdapter from "./adapters/MemcachedStorageAdapter";
import InMemoryStorageAdapter from "./adapters/InMemoryStorageAdapter";
import PostgreSQLStorageAdapter from "./adapters/PostgreSQLStorageAdapter";
import MongoDBStorageAdapter from "./adapters/MongoDBStorageAdapter";
import FilesystemStorageAdapter from "./adapters/FilesystemStorageAdapter";
import { SQLiteStorageAdapter } from "./adapters/SQLiteStorageAdapter";
import { HazelcastStorageAdapter } from "./adapters/HazelcastStorageAdapter";
import { IgniteStorageAdapter } from "./adapters/IgniteStorageAdapter";
import { EtcdStorageAdapter } from "./adapters/EtcdStorageAdapter";
import ReadThroughManager from "./managers/ReadThroughManager";
import WriteThroughManager from "./managers/WriteThroughManager";
import RefreshAheadManager from "./managers/RefreshAheadManager";

export {
  CacheOptions,
  StorageAdapter,
  StorageAdapterOptions,
  Record,
  Tag,
  Tags,
  RedisStorageAdapter,
  MemcachedStorageAdapter,
  InMemoryStorageAdapter,
  PostgreSQLStorageAdapter,
  MongoDBStorageAdapter,
  FilesystemStorageAdapter,
  SQLiteStorageAdapter,
  HazelcastStorageAdapter,
  IgniteStorageAdapter,
  EtcdStorageAdapter,
  ReadThroughManager,
  RefreshAheadManager,
  WriteThroughManager,
};
export * from "./errors/constants";
export { LockedKeyRetrieveStrategy } from "./LockedKeyRetrieveStrategy";
export default Cache;
