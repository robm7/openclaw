/**
 * Pack Scoring Phase A
 *
 * Implements deterministic local scoring for ClarityBurst contract routing.
 * Based on PHASE_A_DETERMINISTIC_SCORING_SPEC.md.
 */

import type { OntologyPack } from "./pack-registry.js";

export interface PhaseAScoringResult {
  top1: { contract_id: string; score: number };
  top2: { contract_id: string; score: number };
  meetsThreshold: boolean;
  isDominant: boolean;
  router_version: string;
}

export function normalizePhaseAText(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Phase A phrase score for one contract: fraction of the contract's canonical
 * phrases that appear as a contiguous token subsequence of the user's tokens.
 * Synonym-aware: a user token matches a phrase token if equal OR listed as a
 * synonym of it in the contract's synonymPhrases. Deterministic; no transformer.
 * Returns 0..1. Empty canonicalPhrases -> 0.
 */
export function phraseScorePhaseA(
  canonicalPhrases: string[],
  synonymPhrases: Record<string, string[]>,
  userTokens: string[],
): number {
  if (!canonicalPhrases || canonicalPhrases.length === 0) {
    return 0;
  }

  // token a "matches" token b if equal, or a is a listed synonym of b
  const tokenMatches = (userTok: string, phraseTok: string): boolean => {
    if (userTok === phraseTok) {
      return true;
    }
    const syns = synonymPhrases?.[phraseTok];
    return Array.isArray(syns) && syns.includes(userTok);
  };

  let matched = 0;
  for (const phrase of canonicalPhrases) {
    const phraseToks = normalizePhaseAText(phrase);
    if (phraseToks.length === 0) {
      continue;
    }
    // does phraseToks appear as a contiguous subsequence of userTokens?
    let found = false;
    for (let i = 0; i + phraseToks.length <= userTokens.length; i++) {
      let all = true;
      for (let j = 0; j < phraseToks.length; j++) {
        if (!tokenMatches(userTokens[i + j], phraseToks[j])) {
          all = false;
          break;
        }
      }
      if (all) {
        found = true;
        break;
      }
    }
    if (found) {
      matched++;
    }
  }
  return matched / canonicalPhrases.length;
}

/**
 * Phase A keyword score for one contract: weighted coverage of the contract's
 * keywords by the user's tokens. A keyword contributes its weight if it (or one
 * of its synonyms) appears in userTokens. Score = sum of contributing weights /
 * sum of all weights, in 0..1. Synonym-aware, deterministic, no transformer.
 * Empty keywordWeights or zero total weight -> 0.
 */
export function keywordScorePhaseA(
  keywordWeights: Record<string, number>,
  synonymPhrases: Record<string, string[]>,
  userTokens: string[],
): number {
  const entries = Object.entries(keywordWeights ?? {});
  if (entries.length === 0) {
    return 0;
  }

  const tokenSet = new Set(userTokens);

  const keywordPresent = (kw: string): boolean => {
    if (tokenSet.has(kw)) {
      return true;
    }
    const syns = synonymPhrases?.[kw];
    if (Array.isArray(syns)) {
      for (const s of syns) {
        if (tokenSet.has(s)) {
          return true;
        }
      }
    }
    return false;
  };

  let totalWeight = 0;
  let matchedWeight = 0;
  for (const [kw, weight] of entries) {
    totalWeight += weight;
    if (keywordPresent(kw)) {
      matchedWeight += weight;
    }
  }
  if (totalWeight === 0) {
    return 0;
  }
  return matchedWeight / totalWeight;
}

/**
 * Phase A deterministic scorer. Local, no network, no transformer.
 * Blends phrase + keyword signals per each contract's own lambdas; the semantic
 * term is structurally excluded (the transformer runs server-side only, so no
 * local semantic score exists to weight — lambda_semantic's term is dropped).
 * Ranks allowed contracts, breaks ties deterministically by contract_id, and
 * computes meetsThreshold / isDominant against the pack thresholds.
 */
export function scorePackPhaseA(
  pack: OntologyPack,
  allowedContractIds: string[],
  userText: string,
): PhaseAScoringResult {
  const ROUTER_VERSION = "phase-a-deterministic-v1";
  const allowedSet = new Set(allowedContractIds);
  const userTokens = normalizePhaseAText(userText);

  const scored = pack.contracts
    .filter((c) => allowedSet.has(c.contract_id))
    .map((c) => {
      const lambdas = c.scoring?.lambdas;
      const lambdaPhrase = lambdas?.lambda_phrase ?? 0;
      const lambdaKeyword = lambdas?.lambda_keyword ?? 0;
      // lambda_semantic intentionally unused: no local transformer, no semantic score
      const phraseScore = phraseScorePhaseA(c.canonicalPhrases, c.synonymPhrases, userTokens);
      const keywordScore = keywordScorePhaseA(c.keywordWeights, c.synonymPhrases, userTokens);
      const score = lambdaPhrase * phraseScore + lambdaKeyword * keywordScore;
      return { contract_id: c.contract_id, score };
    });

  // Deterministic ordering: score desc, then contract_id asc for ties.
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.contract_id < b.contract_id ? -1 : a.contract_id > b.contract_id ? 1 : 0;
  });

  const top1 = scored[0] ?? { contract_id: "", score: 0 };
  const top2 = scored[1] ?? { contract_id: "", score: 0 };

  const meetsThreshold = top1.score >= pack.thresholds.min_confidence_T;
  const isDominant = top1.score - top2.score >= pack.thresholds.dominance_margin_Delta;

  return {
    top1: { contract_id: top1.contract_id, score: top1.score },
    top2: { contract_id: top2.contract_id, score: top2.score },
    meetsThreshold,
    isDominant,
    router_version: ROUTER_VERSION,
  };
}
