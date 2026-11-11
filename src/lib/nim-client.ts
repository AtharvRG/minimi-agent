import OpenAI from "openai";

const MAX_RPM_PER_KEY = 38; // Safe guardrail below NVIDIA NIM's 40 RPM limit
const WINDOW_MS = 60_000;

interface KeyBucket {
  key: string;
  client: OpenAI;
  timestamps: number[];
}

class NimRateLimitedPool {
  private buckets: KeyBucket[] = [];
  private currentIndex = 0;

  constructor() {
    const rawKeys = process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY || "";
    const keys = rawKeys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const baseURL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";

    if (keys.length === 0) {
      console.warn("⚠️ No NVIDIA_API_KEYS found in environment variables.");
    }

    this.buckets = keys.map((key) => ({
      key,
      client: new OpenAI({ apiKey: key, baseURL }),
      timestamps: [],
    }));
  }

  private pruneOldTimestamps(bucket: KeyBucket, now: number) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < WINDOW_MS);
  }

  /**
   * Acquires an OpenAI-compatible NVIDIA NIM client guaranteed to be under 38 RPM.
   * Rotates across multiple keys if configured, or waits until a slot frees up.
   */
  async acquireClient(): Promise<{ client: OpenAI; rpmUsed: number; keyIndex: number }> {
    if (this.buckets.length === 0) {
      throw new Error("Missing NVIDIA_API_KEYS in .env.local");
    }

    while (true) {
      const now = Date.now();

      // Try round-robin across available keys
      for (let i = 0; i < this.buckets.length; i++) {
        const idx = (this.currentIndex + i) % this.buckets.length;
        const bucket = this.buckets[idx];
        this.pruneOldTimestamps(bucket, now);

        if (bucket.timestamps.length < MAX_RPM_PER_KEY) {
          bucket.timestamps.push(now);
          this.currentIndex = (idx + 1) % this.buckets.length;
          return {
            client: bucket.client,
            rpmUsed: bucket.timestamps.length,
            keyIndex: idx + 1,
          };
        }
      }

      // All keys are at 38 RPM: calculate earliest slot release and sleep briefly
      const earliestRelease = Math.min(
        ...this.buckets.map((b) => (b.timestamps[0] || now) + WINDOW_MS - now)
      );
      const waitMs = Math.max(250, earliestRelease + 50);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export const nimPool = new NimRateLimitedPool();
export const DEFAULT_NIM_MODEL =
  process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";