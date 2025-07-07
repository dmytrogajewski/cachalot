import { BloomFilter, BloomFilterOptions } from "./BloomFilter";
import { Logger } from "./Logger";

// Mock logger for testing
const mockLogger: Logger = {
  info: jest.fn(),
  trace: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe("BloomFilter", () => {
  let bloomFilter: BloomFilter;
  let options: BloomFilterOptions;

  beforeEach(() => {
    options = {
      expectedElements: 1000,
      falsePositiveRate: 0.01,
      logger: mockLogger,
    };
    bloomFilter = new BloomFilter(options);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with correct parameters", () => {
      expect(bloomFilter).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Bloom filter initialized with size:")
      );
    });
  });

  describe("add and mightContain", () => {
    it("should add key and return true for existing key", () => {
      const key = "test-key";
      
      bloomFilter.add(key);
      
      expect(bloomFilter.mightContain(key)).toBe(true);
    });

    it("should return false for non-existent key", () => {
      const key = "test-key";
      const nonExistentKey = "non-existent-key";
      
      bloomFilter.add(key);
      
      expect(bloomFilter.mightContain(nonExistentKey)).toBe(false);
    });

    it("should handle multiple keys", () => {
      const keys = ["key1", "key2", "key3", "key4", "key5"];
      
      keys.forEach(key => bloomFilter.add(key));
      
      keys.forEach(key => {
        expect(bloomFilter.mightContain(key)).toBe(true);
      });
      
      expect(bloomFilter.mightContain("non-existent")).toBe(false);
    });

    it("should handle empty string key", () => {
      const key = "";
      
      bloomFilter.add(key);
      
      expect(bloomFilter.mightContain(key)).toBe(true);
    });

    it("should handle special characters in key", () => {
      const key = "test-key-with-special-chars!@#$%^&*()";
      
      bloomFilter.add(key);
      
      expect(bloomFilter.mightContain(key)).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      const stats = bloomFilter.getStats();
      
      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("hashCount");
      expect(stats).toHaveProperty("elementCount");
      expect(stats).toHaveProperty("falsePositiveRate");
      expect(stats).toHaveProperty("loadFactor");
      
      expect(stats.elementCount).toBe(0);
      expect(stats.loadFactor).toBe(0);
    });

    it("should update statistics after adding elements", () => {
      bloomFilter.add("key1");
      bloomFilter.add("key2");
      
      const stats = bloomFilter.getStats();
      
      expect(stats.elementCount).toBe(2);
      expect(stats.loadFactor).toBeGreaterThan(0);
    });
  });

  describe("getFalsePositiveRate", () => {
    it("should return 0 for empty filter", () => {
      expect(bloomFilter.getFalsePositiveRate()).toBe(0);
    });

    it("should increase with more elements", () => {
      const initialRate = bloomFilter.getFalsePositiveRate();
      
      bloomFilter.add("key1");
      bloomFilter.add("key2");
      
      const newRate = bloomFilter.getFalsePositiveRate();
      
      expect(newRate).toBeGreaterThan(initialRate);
    });
  });

  describe("clear", () => {
    it("should clear all elements", () => {
      bloomFilter.add("key1");
      bloomFilter.add("key2");
      
      expect(bloomFilter.mightContain("key1")).toBe(true);
      expect(bloomFilter.mightContain("key2")).toBe(true);
      
      bloomFilter.clear();
      
      expect(bloomFilter.mightContain("key1")).toBe(false);
      expect(bloomFilter.mightContain("key2")).toBe(false);
      
      const stats = bloomFilter.getStats();
      expect(stats.elementCount).toBe(0);
      expect(stats.loadFactor).toBe(0);
    });

    it("should log clear operation", () => {
      bloomFilter.clear();
      
      expect(mockLogger.info).toHaveBeenCalledWith("Bloom filter cleared");
    });
  });

  describe("false positive rate", () => {
    it("should maintain acceptable false positive rate", () => {
      const keys = Array.from({ length: 100 }, (_, i) => `key${i}`);
      const nonExistentKeys = Array.from({ length: 100 }, (_, i) => `non-existent${i}`);
      
      // Add all keys to the filter
      keys.forEach(key => bloomFilter.add(key));
      
      // Check for non-existent keys
      const falsePositives = nonExistentKeys.filter(key => bloomFilter.mightContain(key));
      const falsePositiveRate = falsePositives.length / nonExistentKeys.length;
      
      // The false positive rate should be close to the expected rate (0.01)
      expect(falsePositiveRate).toBeLessThan(0.05); // Allow some tolerance
    });
  });
}); 