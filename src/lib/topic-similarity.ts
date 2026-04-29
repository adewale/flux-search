/**
 * Cross-validation of topic similarity: blend embedding cosine with
 * co-occurrence Jaccard so neither signal monopolises the "related"
 * relationship.
 *
 * Both signals come from the same corpus — Vectorize embeds topic text
 * with bge-base-en-v1.5; Jaccard counts pairs of issues. Flux blends
 * them so a topic that's textually similar but never appears alongside
 * the seed (the model knows them as
 * synonyms even when the corpus doesn't pair them) still surfaces.
 *
 * The math here is pure and stub-able — the embedder is a function the
 * caller injects, so tests can supply deterministic vectors.
 */

export interface TopicEmbedding {
  keyword: string;
  vector: number[];
}

/** Pure cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const value = dot / (Math.sqrt(na) * Math.sqrt(nb));
  // Floating-point underflow on tiny vectors can nudge the quotient just
  // outside the mathematical cosine bounds; clamp to the invariant.
  return Math.max(-1, Math.min(1, value));
}

/** Jaccard over the issue-set of each topic (cardinalities pre-computed). */
export function jaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface SimilarityPair {
  keyword_a: string;
  keyword_b: string;
  cosine: number;
  jaccard: number;
  /**
   * Blended score — α·cosine + (1-α)·jaccard. α defaults to 0.6 so
   * embedding similarity dominates slightly (it captures synonymy that
   * Jaccard cannot), while Jaccard keeps corpus-grounded support.
   */
  blended: number;
}

export interface BuildSimilarityOptions {
  alpha?: number;
  /** Drop pairs whose blended score is below this. Default 0.2 keeps
   *  the table small and the noise low. */
  minBlended?: number;
}

/**
 * Compute pairwise similarities between corpus topics. The caller is
 * responsible for embedding (passing a precomputed `embeddings` array)
 * and gathering each topic's issue-set (`issueSets`). The function
 * returns a sparse list of pairs above `minBlended`.
 */
export function buildTopicSimilarities(
  embeddings: TopicEmbedding[],
  issueSets: Map<string, Set<string>>,
  opts: BuildSimilarityOptions = {},
): SimilarityPair[] {
  const alpha = opts.alpha ?? 0.6;
  const minBlended = opts.minBlended ?? 0.2;
  const out: SimilarityPair[] = [];

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const a = embeddings[i];
      const b = embeddings[j];
      const cos = cosine(a.vector, b.vector);
      const jac = jaccard(
        issueSets.get(a.keyword) ?? new Set(),
        issueSets.get(b.keyword) ?? new Set(),
      );
      const blended = alpha * cos + (1 - alpha) * jac;
      if (blended < minBlended) continue;
      // Push both directions so the route can do single-key lookups.
      out.push({ keyword_a: a.keyword, keyword_b: b.keyword, cosine: cos, jaccard: jac, blended });
      out.push({ keyword_a: b.keyword, keyword_b: a.keyword, cosine: cos, jaccard: jac, blended });
    }
  }
  return out;
}
