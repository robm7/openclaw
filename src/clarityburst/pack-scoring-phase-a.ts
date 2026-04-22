/**
 * Pack Scoring Phase A
 *
 * Implements deterministic local scoring for ClarityBurst contract routing.
 * Based on PHASE_A_DETERMINISTIC_SCORING_SPEC.md.
 */

import type { OntologyPack } from "./pack-registry.js";

export interface PhaseAScoringResult {
  top1: {
    contract_id: string;
    score: number;
  };
  top2: {
    contract_id: string;
    score: number;
  };
}

/**
 * Score a pack using Phase A deterministic scoring.
 *
 * @param pack - The ontology pack to score
 * @param allowedContractIds - Array of allowed contract IDs
 * @param _userText - User text for context (used for phrase matching)
 * @returns Phase A scoring result with top1 and top2 contracts
 */
export function scorePackPhaseA(
  pack: OntologyPack,
  allowedContractIds: string[],
  _userText: string,
): PhaseAScoringResult {
  // TODO: Implement proper Phase A scoring according to spec
  // For now, return a dummy result that selects the first allowed contract

  if (!pack.contracts || pack.contracts.length === 0) {
    return {
      top1: { contract_id: "", score: 0 },
      top2: { contract_id: "", score: 0 },
    };
  }

  // Filter to allowed contracts
  const allowedContracts = pack.contracts.filter((contract) =>
    allowedContractIds.includes(contract.contract_id),
  );

  if (allowedContracts.length === 0) {
    return {
      top1: { contract_id: "", score: 0 },
      top2: { contract_id: "", score: 0 },
    };
  }

  // Simple dummy scoring: first contract gets score 1.0, second gets 0.5
  const top1 = allowedContracts[0];
  const top2 = allowedContracts.length > 1 ? allowedContracts[1] : allowedContracts[0];

  return {
    top1: {
      contract_id: top1.contract_id,
      score: 1.0,
    },
    top2: {
      contract_id: top2.contract_id,
      score: allowedContracts.length > 1 ? 0.5 : 0.0,
    },
  };
}
