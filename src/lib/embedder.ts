import path from "path";
import {
  pipeline,
  env,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

// Cache the quantized ONNX model inside the project folder so everything stays local
env.cacheDir = path.join(process.cwd(), ".models");
env.allowLocalModels = true;

// IBM Granite R2 Small English ONNX (384-dim, low RAM, fast CPU inference)
const EMBED_MODEL_ID = "onnx-community/granite-embedding-small-english-r2-ONNX";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", EMBED_MODEL_ID, {
      dtype: "q8", // 8-bit quantized for fast laptop CPU execution & low RAM
    }).catch((err: unknown) => {
      console.error("Failed to load Granite R2 ONNX, falling back to MiniLM:", err);
      return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        dtype: "q8",
      });
    });
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<number[]> {
  try {
    const extractor = await getExtractor();
    const clean = text.slice(0, 2000).replace(/\s+/g, " ").trim();
    const output = await extractor(clean, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  } catch (err: unknown) {
    console.warn("Local embedding fallback triggered:", err);
    return [];
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // Already L2-normalized
}