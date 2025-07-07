import FilesystemStorageAdapter from "./FilesystemStorageAdapter";
import { ConnectionStatus } from "../ConnectionStatus";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";

describe("FilesystemStorageAdapter", () => {
  let adapter: FilesystemStorageAdapter;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(tmpdir(), "cachalot-fs-test-"));
    adapter = new FilesystemStorageAdapter({ dir: testDir });
  });

  afterEach(() => {
    if ((fs as any).rmSync) {
      (fs as any).rmSync(testDir, { recursive: true, force: true });
    } else {
      fs.rmdirSync(testDir);
    }
  });

  it("should have CONNECTED status", () => {
    expect(adapter.getConnectionStatus()).toBe(ConnectionStatus.CONNECTED);
  });

  it("should call onConnect callback immediately", (done) => {
    adapter.onConnect(() => done());
  });

  it("should set and get a value", async () => {
    await adapter.set("foo", "bar");
    expect(await adapter.get("foo")).toBe("bar");
  });

  it("should return null for non-existent key", async () => {
    expect(await adapter.get("nope")).toBeNull();
  });

  it("should set and get multiple values (mset/mget)", async () => {
    const values = new Map([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
    await adapter.mset(values);
    const result = await adapter.mget(["a", "b", "c", "d"]);
    expect(result).toEqual(["1", "2", "3", null]);
  });

  it("should delete a value", async () => {
    await adapter.set("foo", "bar");
    expect(await adapter.del("foo")).toBe(true);
    expect(await adapter.get("foo")).toBeNull();
  });

  it("should return false when deleting non-existent key", async () => {
    expect(await adapter.del("nope")).toBe(false);
  });

  it("should expire a value after TTL", async () => {
    await adapter.set("foo", "bar", 10);
    await new Promise((r) => setTimeout(r, 20));
    expect(await adapter.get("foo")).toBeNull();
  });

  it("should acquire and release a lock", async () => {
    expect(await adapter.acquireLock("lock1")).toBe(true);
    expect(await adapter.isLockExists("lock1")).toBe(true);
    expect(await adapter.releaseLock("lock1")).toBe(true);
    expect(await adapter.isLockExists("lock1")).toBe(false);
  });

  it("should not acquire a lock if already locked", async () => {
    expect(await adapter.acquireLock("lock2")).toBe(true);
    expect(await adapter.acquireLock("lock2")).toBe(false);
  });

  it("should acquire a lock after expiration", async () => {
    expect(await adapter.acquireLock("lock3", 10)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(await adapter.acquireLock("lock3")).toBe(true);
  });

  it("should handle setOptions as a no-op", () => {
    expect(() => adapter.setOptions()).not.toThrow();
  });
}); 