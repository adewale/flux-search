/**
 * Workers-AI–backed embedder for topic strings. The default impl uses
 * `@cf/baai/bge-base-en-v1.5` (the same model flux uses for chunk
 * embeddings), but the function is parameterised so tests can pass a
 * deterministic stub.
 */

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * Build an EmbedFn from a Workers-AI binding. Batches in groups of 50
 * to stay under the model's per-call token ceiling.
 */
export function workersAIEmbedder(ai: { run: (model: string, args: any) => Promise<any> }): EmbedFn {
  return async (texts: string[]) => {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    const batchSize = 50;
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      try {
        const result = await ai.run('@cf/baai/bge-base-en-v1.5', { text: slice });
        const data = (result as any)?.data;
        if (Array.isArray(data)) {
          for (const v of data) out.push(Array.isArray(v) ? v : []);
        } else {
          for (let j = 0; j < slice.length; j++) out.push([]);
        }
      } catch {
        // Best-effort: skip the batch and continue.
        for (let j = 0; j < slice.length; j++) out.push([]);
      }
    }
    return out;
  };
}
