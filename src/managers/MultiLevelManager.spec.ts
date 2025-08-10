import MultiLevelManager, { CacheLevel } from "./MultiLevelManager";
import { Logger } from "../Logger";
import { Storage } from "../storage/Storage";
import { Record } from "../storage/Record";
import { ConnectionStatus } from "../ConnectionStatus";

// Mock logger
const mockLogger: Logger = {
  info: jest.fn(),
  trace: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock storage for L1 (memory)
const mockL1Storage: Storage = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  touch: jest.fn(),
  getTags: jest.fn(),
  lockKey: jest.fn(),
  releaseKey: jest.fn(),
  keyIsLocked: jest.fn(),
  isOutdated: jest.fn(),
  getConnectionStatus: jest.fn().mockReturnValue(ConnectionStatus.CONNECTED),
};

// Mock storage for L2 (Redis)
const mockL2Storage: Storage = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  touch: jest.fn(),
  getTags: jest.fn(),
  lockKey: jest.fn(),
  releaseKey: jest.fn(),
  keyIsLocked: jest.fn(),
  isOutdated: jest.fn(),
  getConnectionStatus: jest.fn().mockReturnValue(ConnectionStatus.CONNECTED),
};

describe("MultiLevelManager", () => {
  let manager: MultiLevelManager;
  let levels: CacheLevel[];

  beforeEach(() => {
    levels = [
      {
        name: "L1-Memory",
        storage: mockL1Storage,
        priority: 1,
        ttl: 60000, // 1 minute
        enabled: true,
      },
      {
        name: "L2-Redis",
        storage: mockL2Storage,
        priority: 2,
        ttl: 3600000, // 1 hour
        enabled: true,
      },
    ];

    manager = new MultiLevelManager({
      levels,
      logger: mockLogger,
      storage: mockL1Storage, // Default storage
      fallbackStrategy: "executor",
      enableBloomFilter: false,
    });

    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with correct levels", () => {
      expect(manager).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("MultiLevelManager initialized with 2 levels")
      );
    });

    it("should sort levels by priority", () => {
      const sortedLevels = manager.getLevels();
      expect(sortedLevels[0].priority).toBe(1);
      expect(sortedLevels[1].priority).toBe(2);
    });
  });

  describe("get", () => {
    it("should return value from L1 if available", async () => {
      const key = "test-key";
      const value = "test-value";
      
      const mockRecord: Record<string> = {
        key,
        value: JSON.stringify(value),
        createdAt: Date.now(),
        expiresIn: 60000,
        permanent: false,
        tags: [],
      };

      (mockL1Storage.get as jest.Mock).mockResolvedValue(mockRecord);

      const mockExecutor = jest.fn().mockResolvedValue("executor-result");

      const result = await manager.get(key, mockExecutor);

      expect(result).toBe(value);
      expect(mockL1Storage.get).toHaveBeenCalledWith(key);
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it("should return value from L2 if L1 misses", async () => {
      const key = "test-key";
      const value = "test-value";
      
      const mockRecord: Record<string> = {
        key,
        value: JSON.stringify(value),
        createdAt: Date.now(),
        expiresIn: 3600000,
        permanent: false,
        tags: [],
      };

      (mockL1Storage.get as jest.Mock).mockResolvedValue(null);
      (mockL2Storage.get as jest.Mock).mockResolvedValue(mockRecord);

      const mockExecutor = jest.fn().mockResolvedValue("executor-result");

      const result = await manager.get(key, mockExecutor);

      expect(result).toBe(value);
      expect(mockL1Storage.get).toHaveBeenCalledWith(key);
      expect(mockL2Storage.get).toHaveBeenCalledWith(key);
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it("should run executor if all levels miss", async () => {
      const key = "test-key";
      const executorValue = "executor-result";

      (mockL1Storage.get as jest.Mock).mockResolvedValue(null);
      (mockL2Storage.get as jest.Mock).mockResolvedValue(null);

      const mockExecutor = jest.fn().mockResolvedValue(executorValue);

      const result = await manager.get(key, mockExecutor);

      expect(result).toBe(executorValue);
      expect(mockExecutor).toHaveBeenCalled();
    });

    it("should skip disabled levels", async () => {
      const key = "test-key";
      const value = "test-value";
      
      const mockRecord: Record<string> = {
        key,
        value: JSON.stringify(value),
        createdAt: Date.now(),
        expiresIn: 3600000,
        permanent: false,
        tags: [],
      };

      // Disable L1
      manager.disableLevel("L1-Memory");

      (mockL1Storage.get as jest.Mock).mockResolvedValue(null);
      (mockL2Storage.get as jest.Mock).mockResolvedValue(mockRecord);

      const mockExecutor = jest.fn().mockResolvedValue("executor-result");

      const result = await manager.get(key, mockExecutor);

      expect(result).toBe(value);
      expect(mockL1Storage.get).not.toHaveBeenCalled();
      expect(mockL2Storage.get).toHaveBeenCalledWith(key);
    });

    it("should handle storage errors gracefully", async () => {
      const key = "test-key";
      const executorValue = "executor-result";

      (mockL1Storage.get as jest.Mock).mockRejectedValue(new Error("Storage error"));
      (mockL2Storage.get as jest.Mock).mockResolvedValue(null);

      const mockExecutor = jest.fn().mockResolvedValue(executorValue);

      const result = await manager.get(key, mockExecutor);

      expect(result).toBe(executorValue);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Error accessing level L1-Memory"),
        expect.any(Error)
      );
    });
  });

  describe("set", () => {
    it("should write to all enabled levels", async () => {
      const key = "test-key";
      const value = "test-value";
      
      const mockRecord: Record<string> = {
        key,
        value: JSON.stringify(value),
        createdAt: Date.now(),
        expiresIn: 60000,
        permanent: false,
        tags: [],
      };

      (mockL1Storage.set as jest.Mock).mockResolvedValue(mockRecord);
      (mockL2Storage.set as jest.Mock).mockResolvedValue(mockRecord);

      const result = await manager.set(key, value);

      expect(mockL1Storage.set).toHaveBeenCalledWith(key, value, expect.any(Object));
      expect(mockL2Storage.set).toHaveBeenCalledWith(key, value, expect.any(Object));
      expect(result).toBeDefined();
    });

    it("should use level-specific TTL", async () => {
      const key = "test-key";
      const value = "test-value";

      await manager.set(key, value);

      expect(mockL1Storage.set).toHaveBeenCalledWith(
        key, 
        value, 
        expect.objectContaining({ expiresIn: 60000 })
      );
      expect(mockL2Storage.set).toHaveBeenCalledWith(
        key, 
        value, 
        expect.objectContaining({ expiresIn: 3600000 })
      );
    });

    it("should skip disabled levels during set", async () => {
      const key = "test-key";
      const value = "test-value";

      manager.disableLevel("L2-Redis");

      await manager.set(key, value);

      expect(mockL1Storage.set).toHaveBeenCalled();
      expect(mockL2Storage.set).not.toHaveBeenCalled();
    });
  });

  describe("del", () => {
    it("should delete from all enabled levels", async () => {
      const key = "test-key";

      (mockL1Storage.del as jest.Mock).mockResolvedValue(true);
      (mockL2Storage.del as jest.Mock).mockResolvedValue(true);

      const result = await manager.del(key);

      expect(mockL1Storage.del).toHaveBeenCalledWith(key);
      expect(mockL2Storage.del).toHaveBeenCalledWith(key);
      expect(result).toBe(true);
    });

    it("should return true if any level succeeds", async () => {
      const key = "test-key";

      (mockL1Storage.del as jest.Mock).mockRejectedValue(new Error("L1 error"));
      (mockL2Storage.del as jest.Mock).mockResolvedValue(true);

      const result = await manager.del(key);

      expect(result).toBe(true);
    });
  });

  describe("level management", () => {
    it("should enable and disable levels", () => {
      expect(manager.getLevelStats()).toEqual([
        { name: "L1-Memory", enabled: true, priority: 1 },
        { name: "L2-Redis", enabled: true, priority: 2 },
      ]);

      manager.disableLevel("L1-Memory");

      expect(manager.getLevelStats()).toEqual([
        { name: "L1-Memory", enabled: false, priority: 1 },
        { name: "L2-Redis", enabled: true, priority: 2 },
      ]);

      manager.enableLevel("L1-Memory");

      expect(manager.getLevelStats()).toEqual([
        { name: "L1-Memory", enabled: true, priority: 1 },
        { name: "L2-Redis", enabled: true, priority: 2 },
      ]);
    });
  });

  describe("Bloom filter integration", () => {
    it("should use Bloom filter when enabled", async () => {
      const managerWithBloom = new MultiLevelManager({
        levels,
        logger: mockLogger,
        storage: mockL1Storage,
        enableBloomFilter: true,
        bloomFilterOptions: {
          expectedElements: 1000,
          falsePositiveRate: 0.01,
        },
      });

      const key = "test-key";
      const mockExecutor = jest.fn().mockResolvedValue("executor-result");

      (mockL1Storage.get as jest.Mock).mockResolvedValue(null);
      (mockL2Storage.get as jest.Mock).mockResolvedValue(null);

      await managerWithBloom.get(key, mockExecutor);

      expect(mockExecutor).toHaveBeenCalled();
    });
  });
}); 