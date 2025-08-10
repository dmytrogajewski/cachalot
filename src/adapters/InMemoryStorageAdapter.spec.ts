import { ConnectionStatus } from "../ConnectionStatus";
import { InMemoryStorageAdapter } from "./InMemoryStorageAdapter";

describe("InMemoryStorageAdapter", () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  describe("constructor", () => {
    it("should create adapter with default options", () => {
      const adapter = new InMemoryStorageAdapter();
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.CONNECTED);
    });

    it("should create adapter with custom options", () => {
      const adapter = new InMemoryStorageAdapter({
        maxSize: 100,
        cleanupInterval: 30000,
      });
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.CONNECTED);
    });
  });

  describe("getConnectionStatus", () => {
    it("should always return CONNECTED", () => {
      expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.CONNECTED);
    });
  });

  describe("onConnect", () => {
    it("should call callback immediately", (done) => {
      adapter.onConnect(() => {
        done();
      });
    });
  });

  describe("set", () => {
    it("should set a value", async () => {
      const result = await adapter.set("test-key", "test-value");
      expect(result).toBe(true);
    });

    it("should set a value with expiration", async () => {
      const result = await adapter.set("test-key", "test-value", 1000);
      expect(result).toBe(true);
    });

    it("should evict oldest item when max size reached", async () => {
      const adapter = new InMemoryStorageAdapter({ maxSize: 2 });
      
      await adapter.set("key1", "value1");
      await adapter.set("key2", "value2");
      await adapter.set("key3", "value3"); // Should evict key1
      
      expect(await adapter.get("key1")).toBeNull();
      expect(await adapter.get("key2")).toBe("value2");
      expect(await adapter.get("key3")).toBe("value3");
      
      adapter.destroy();
    });
  });

  describe("get", () => {
    it("should return null for non-existent key", async () => {
      const result = await adapter.get("non-existent");
      expect(result).toBeNull();
    });

    it("should return value for existing key", async () => {
      await adapter.set("test-key", "test-value");
      const result = await adapter.get("test-key");
      expect(result).toBe("test-value");
    });

    it("should return null for expired key", async () => {
      await adapter.set("test-key", "test-value", 1);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const result = await adapter.get("test-key");
      expect(result).toBeNull();
    });
  });

  describe("mset", () => {
    it("should set multiple values", async () => {
      const values = new Map([
        ["key1", "value1"],
        ["key2", "value2"],
        ["key3", "value3"],
      ]);

      await adapter.mset(values);

      expect(await adapter.get("key1")).toBe("value1");
      expect(await adapter.get("key2")).toBe("value2");
      expect(await adapter.get("key3")).toBe("value3");
    });

    it("should handle empty map", async () => {
      await expect(adapter.mset(new Map())).resolves.not.toThrow();
    });
  });

  describe("mget", () => {
    it("should get multiple values", async () => {
      await adapter.set("key1", "value1");
      await adapter.set("key2", "value2");
      await adapter.set("key3", "value3");

      const results = await adapter.mget(["key1", "key2", "key3", "non-existent"]);
      expect(results).toEqual(["value1", "value2", "value3", null]);
    });

    it("should handle empty array", async () => {
      const results = await adapter.mget([]);
      expect(results).toEqual([]);
    });

    it("should handle expired items", async () => {
      await adapter.set("key1", "value1", 1);
      await adapter.set("key2", "value2");
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const results = await adapter.mget(["key1", "key2"]);
      expect(results).toEqual([null, "value2"]);
    });
  });

  describe("del", () => {
    it("should delete existing key", async () => {
      await adapter.set("test-key", "test-value");
      const result = await adapter.del("test-key");
      expect(result).toBe(true);
      expect(await adapter.get("test-key")).toBeNull();
    });

    it("should return false for non-existent key", async () => {
      const result = await adapter.del("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("acquireLock", () => {
    it("should acquire lock successfully", async () => {
      const result = await adapter.acquireLock("test-key");
      expect(result).toBe(true);
    });

    it("should not acquire lock if already locked", async () => {
      await adapter.acquireLock("test-key");
      const result = await adapter.acquireLock("test-key");
      expect(result).toBe(false);
    });

    it("should acquire lock with custom timeout", async () => {
      const result = await adapter.acquireLock("test-key", 5000);
      expect(result).toBe(true);
    });
  });

  describe("releaseLock", () => {
    it("should release existing lock", async () => {
      await adapter.acquireLock("test-key");
      const result = await adapter.releaseLock("test-key");
      expect(result).toBe(true);
    });

    it("should return false for non-existent lock", async () => {
      const result = await adapter.releaseLock("test-key");
      expect(result).toBe(false);
    });
  });

  describe("isLockExists", () => {
    it("should return true for existing lock", async () => {
      await adapter.acquireLock("test-key");
      const result = await adapter.isLockExists("test-key");
      expect(result).toBe(true);
    });

    it("should return false for non-existent lock", async () => {
      const result = await adapter.isLockExists("test-key");
      expect(result).toBe(false);
    });

    it("should return false for expired lock", async () => {
      await adapter.acquireLock("test-key", 1);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const result = await adapter.isLockExists("test-key");
      expect(result).toBe(false);
    });
  });

  describe("setOptions", () => {
    it("should not throw error", () => {
      expect(() => adapter.setOptions()).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should remove expired items", async () => {
      await adapter.set("key1", "value1", 1);
      await adapter.set("key2", "value2");
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Trigger cleanup manually
      (adapter as any).cleanup();
      
      expect(await adapter.get("key1")).toBeNull();
      expect(await adapter.get("key2")).toBe("value2");
    });
  });

  describe("destroy", () => {
    it("should clear storage and stop cleanup timer", () => {
      adapter.destroy();
      
      // Should not throw when called multiple times
      expect(() => adapter.destroy()).not.toThrow();
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      const stats = adapter.getStats();
      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("locks");
      expect(stats).toHaveProperty("maxSize");
      expect(typeof stats.size).toBe("number");
      expect(typeof stats.locks).toBe("number");
      expect(typeof stats.maxSize).toBe("number");
    });
  });

  describe("concurrent operations", () => {
    it("should handle concurrent sets", async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        adapter.set(`key${i}`, `value${i}`)
      );
      
      const results = await Promise.all(promises);
      expect(results.every(result => result === true)).toBe(true);
    });

    it("should handle concurrent gets", async () => {
      await adapter.set("test-key", "test-value");
      
      const promises = Array.from({ length: 100 }, () =>
        adapter.get("test-key")
      );
      
      const results = await Promise.all(promises);
      expect(results.every(result => result === "test-value")).toBe(true);
    });
  });
}); 