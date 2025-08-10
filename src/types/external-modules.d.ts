declare module 'hazelcast-client' {
  export interface HazelcastClientConfiguration {
    clusterName?: string;
    network?: {
      clusterMembers?: string[];
      connectionTimeout?: number;
      connectionAttemptLimit?: number;
      connectionAttemptPeriod?: number;
      reconnectionMode?: string;
      smartRouting?: boolean;
      redoOperation?: boolean;
      connectionTimeout?: number;
    };
    properties?: Record<string, string>;
  }
  
  export class Client {
    static newHazelcastClient(config?: HazelcastClientConfiguration): Promise<HazelcastClient>;
  }
  
  export interface HazelcastClient {
    getMap(name: string): Promise<IMap<string, any>>;
    getCPSubsystem(): {
      getLock(name: string): Promise<ILock>;
    };
    shutdown(): Promise<void>;
  }
  
  export interface IMap<K, V> {
    set(key: K, value: V): Promise<void>;
    setAll(entries: Array<[K, V]>): Promise<void>;
    get(key: K): Promise<V | null>;
    remove(key: K): Promise<V | null>;
    entrySet(): Promise<Array<[K, V]>>;
  }
  
  export interface ILock {
    tryLock(waitTime: number, leaseTime: number): Promise<boolean>;
    tryRelease(): Promise<boolean>;
  }
}

declare module 'apache-ignite-client' {
  export interface IgniteClientConfiguration {
    endpoint?: string;
    username?: string;
    password?: string;
    useSSL?: boolean;
    certificatePath?: string;
    privateKeyPath?: string;
    caPath?: string;
    operationTimeout?: number;
    connectionTimeout?: number;
    retryPolicy?: any;
  }
  
  export class CacheClient {
    constructor();
    connect(config: IgniteClientConfiguration): Promise<void>;
    disconnect(): Promise<void>;
    getOrCreateCache(name: string): Promise<CacheEntry>;
    getOrCreateLock(name: string): Promise<ILock>;
  }
  
  export interface ILock {
    tryLock(timeout: number): Promise<boolean>;
    unlock(): Promise<void>;
  }
  
  export interface CacheEntry {
    put(key: string, value: any): Promise<void>;
    putAll(entries: Map<string, any>): Promise<void>;
    get(key: string): Promise<any>;
    getAll(keys: string[]): Promise<Map<string, any>>;
    remove(key: string): Promise<any>;
    removeAll(keys: string[]): Promise<void>;
    clear(): Promise<void>;
    size(): Promise<number>;
    containsKey(key: string): Promise<boolean>;
    containsKeys(keys: string[]): Promise<boolean[]>;
    replace(key: string, value: any): Promise<boolean>;
    replaceIfEquals(key: string, oldValue: any, newValue: any): Promise<boolean>;
    putIfAbsent(key: string, value: any): Promise<any>;
    getAndPut(key: string, value: any): Promise<any>;
    getAndRemove(key: string): Promise<any>;
    getAndReplace(key: string, value: any): Promise<any>;
    getAndPutIfAbsent(key: string, value: any): Promise<any>;
    removeIfEquals(key: string, value: any): Promise<boolean>;
    removeAll2(keys: string[]): Promise<boolean[]>;
    scanQuery(query?: any): Promise<any[]>;
  }
  

}

declare module 'etcd3' {
  export interface Etcd3Config {
    hosts?: string | string[];
    credentials?: {
      rootCertificate?: Buffer;
      privateKey?: Buffer;
      certChain?: Buffer;
    };
    auth?: {
      username: string;
      password: string;
    };
    namespace?: string;
    retry?: {
      retries?: number;
      factor?: number;
      minTimeout?: number;
      maxTimeout?: number;
    };
  }
  
  export class Etcd3 {
    constructor(config?: Etcd3Config);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    namespace(prefix: string): Namespace;
    lease(ttl: number): Lease;
    lock(name: string): Lock;
  }
  
  export interface Namespace {
    put(key: string, value: string): PutBuilder;
    get(key: string): SingleRangeBuilder;
    delete(key: string): DeleteBuilder;
    getAll(): MultiRangeBuilder;
  }
  
  export interface PutBuilder {
    value(value: string): PutBuilder;
    lease(lease: Lease): PutBuilder;
    exec(): Promise<void>;
  }
  
  export interface SingleRangeBuilder {
    string(): Promise<string | null>;
    buffer(): Promise<Buffer | null>;
    json(): Promise<any | null>;
  }
  
  export interface MultiRangeBuilder {
    prefix(prefix: string): MultiRangeBuilder;
    keys(): Promise<string[]>;
    strings(): Promise<Map<string, string>>;
    buffers(): Promise<Map<string, Buffer>>;
    json(): Promise<Map<string, any>>;
  }
  
  export interface DeleteBuilder {
    key(key: string): DeleteBuilder;
    prefix(prefix: string): DeleteBuilder;
    exec(): Promise<void>;
  }
  
  export interface Lease {
    grant(ttl: number): Promise<void>;
    revoke(): Promise<void>;
    keepalive(): Promise<void>;
    isAlive(): Promise<boolean>;
  }
  
  export interface Lock {
    acquire(ttl?: number): Promise<void>;
    release(): Promise<void>;
    isHeld(): Promise<boolean>;
  }
} 