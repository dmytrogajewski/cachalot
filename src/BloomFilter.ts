import { Logger } from "./Logger";

export interface BloomFilterOptions {
  expectedElements: number;
  falsePositiveRate: number;
  logger: Logger;
}

export class BloomFilter {
  private readonly bitArray: Uint8Array;
  private readonly size: number;
  private readonly hashCount: number;
  private readonly logger: Logger;
  private elementCount: number = 0;

  constructor(options: BloomFilterOptions) {
    this.logger = options.logger;
    this.size = this.calculateOptimalSize(options.expectedElements, options.falsePositiveRate);
    this.hashCount = this.calculateOptimalHashCount(options.expectedElements, this.size);
    this.bitArray = new Uint8Array(Math.ceil(this.size / 8));

    this.logger.info(
      `Bloom filter initialized with size: ${this.size}, hash functions: ${this.hashCount}, expected elements: ${options.expectedElements}`
    );
  }

  /**
   * Add a key to the Bloom filter
   */
  public add(key: string): void {
    const hashes = this.getHashes(key);
    
    for (let i = 0; i < this.hashCount; i++) {
      const bitIndex = hashes[i] % this.size;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      this.bitArray[byteIndex] |= (1 << bitOffset);
    }
    
    this.elementCount++;
  }

  /**
   * Check if a key might exist in the Bloom filter
   * Returns true if the key might exist, false if it definitely doesn't exist
   */
  public mightContain(key: string): boolean {
    const hashes = this.getHashes(key);
    
    for (let i = 0; i < this.hashCount; i++) {
      const bitIndex = hashes[i] % this.size;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      if ((this.bitArray[byteIndex] & (1 << bitOffset)) === 0) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Get the current false positive rate based on the number of elements added
   */
  public getFalsePositiveRate(): number {
    const k = this.hashCount;
    const m = this.size;
    const n = this.elementCount;
    
    return Math.pow(1 - Math.exp(-k * n / m), k);
  }

  /**
   * Get statistics about the Bloom filter
   */
  public getStats(): {
    size: number;
    hashCount: number;
    elementCount: number;
    falsePositiveRate: number;
    loadFactor: number;
  } {
    return {
      size: this.size,
      hashCount: this.hashCount,
      elementCount: this.elementCount,
      falsePositiveRate: this.getFalsePositiveRate(),
      loadFactor: this.elementCount / this.size,
    };
  }

  /**
   * Clear the Bloom filter
   */
  public clear(): void {
    this.bitArray.fill(0);
    this.elementCount = 0;
    this.logger.info("Bloom filter cleared");
  }

  /**
   * Calculate optimal size for the bit array
   */
  private calculateOptimalSize(expectedElements: number, falsePositiveRate: number): number {
    return Math.ceil(-expectedElements * Math.log(falsePositiveRate) / Math.pow(Math.log(2), 2));
  }

  /**
   * Calculate optimal number of hash functions
   */
  private calculateOptimalHashCount(expectedElements: number, size: number): number {
    return Math.ceil((size / expectedElements) * Math.log(2));
  }

  /**
   * Generate multiple hash values for a key using different seeds
   */
  private getHashes(key: string): number[] {
    const hashes: number[] = [];
    
    for (let i = 0; i < this.hashCount; i++) {
      hashes.push(this.hash(key, i));
    }
    
    return hashes;
  }

  /**
   * Simple hash function using different seeds
   */
  private hash(key: string, seed: number): number {
    let hash = seed;
    
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash + char) & 0xffffffff;
    }
    
    return Math.abs(hash);
  }
} 