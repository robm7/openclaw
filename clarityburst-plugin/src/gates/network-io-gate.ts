/**
 * NETWORK_IO gate — routing half (split out of the fork's
 * src/clarityburst/network-io-gating.ts per FORK_AUDIT_HOOK_MAPPING.md).
 *
 * Plugin side (this module): URL/operation signal extraction, NetworkContext
 * construction, applyNetworkOverrides() routing, abstain mapping.
 *
 * OpenClaw side (remains in the fork): the actual fetch() invocation and
 * response lifecycle — executed only when this gate returns (PROCEED).
 * That half gets wired to the hook's PROCEED branch in the next stage.
 */

import { ClarityBurstAbstainError } from "../errors.js";
import { applyNetworkOverrides, type NetworkContext } from "../decision-override.js";
import { createSubsystemLogger } from "../internal/logging.js";

const gatingLog = createSubsystemLogger("clarityburst-network-io-gate");

export type NetworkGateDecision = Awaited<ReturnType<typeof applyNetworkOverrides>>;

/** Extract HTTP method from fetch options (signal extraction). */
export function extractMethodFromOptions(init?: RequestInit): string {
  return init?.method?.toUpperCase() ?? "GET";
}

/** Extract hostname from URL for routing/logging (signal extraction). */
export function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

/**
 * Route a network request through the NETWORK_IO gate.
 * Throws ClarityBurstAbstainError on ABSTAIN_CONFIRM / ABSTAIN_CLARIFY.
 * Returns the gate decision on PROCEED. Performs NO network I/O itself.
 */
export async function gateNetworkIO(url: string, init?: RequestInit): Promise<NetworkGateDecision> {
  const method = extractMethodFromOptions(init);
  const hostname = extractHostname(url);

  const context: NetworkContext = {
    stageId: "NETWORK_IO",
    operation: method,
    url: hostname,
    userConfirmed: false,
  };

  const gateResult = await applyNetworkOverrides(context);

  gatingLog.debug("NETWORK_IO gate decision", {
    contractId: gateResult.contractId,
    outcome: gateResult.outcome,
    method,
    hostname,
  });

  if (gateResult.outcome === "ABSTAIN_CONFIRM" || gateResult.outcome === "ABSTAIN_CLARIFY") {
    gatingLog.warn("NETWORK_IO gate blocked request", {
      contractId: gateResult.contractId,
      reason: gateResult.reason,
      hostname,
    });
    throw new ClarityBurstAbstainError({
      stageId: "NETWORK_IO",
      outcome: gateResult.outcome,
      reason: gateResult.reason as never,
      contractId: gateResult.contractId,
      instructions:
        gateResult.instructions ??
        `Network request to ${hostname} blocked by ClarityBurst NETWORK_IO gate.`,
    });
  }

  gatingLog.debug("NETWORK_IO gate approved request", {
    contractId: gateResult.contractId,
    hostname,
  });

  return gateResult;
}
