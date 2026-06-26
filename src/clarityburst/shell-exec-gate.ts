import { loadPackOrAbstain } from "./pack-load.js";
import { routeClarityBurst, type RouterResult } from "./router-client.js";
import { ClarityBurstAbstainError } from "./errors.js";
import configManager from "./config.js";
import {
  deriveAllowedContracts,
  createFullCapabilities,
  assertNonEmptyAllowedContracts,
  type RuntimeCapabilities,
} from "./allowed-contracts.js";
import type { OntologyPack } from "./pack-registry.js";

/**
 * Shell Execution Gate
 *
 * Gates shell command execution through ClarityBurst routing.
 * INVARIANT: Fail-closed - blocks execution when pack/router unavailable.
 *
 * @param command - The shell command to gate
 * @returns Gate result indicating allowed/blocked with reason
 */
export async function gateShellExec(command: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  // Early exit: ClarityBurst disabled → proceed (bypass mode)
  // Wrap in try-catch to handle config errors as fail-closed
  let enabled: boolean;
  try {
    enabled = configManager.isEnabled();
  } catch (configError) {
    // Config initialization failed (e.g., missing URL) → treat as router unavailable → BLOCK (fail-closed)
    return {
      allowed: false,
      reason: `ClarityBurst router unavailable (configuration error: ${configError instanceof Error ? configError.message : String(configError)})`,
    };
  }

  if (!enabled) {
    return { allowed: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 1: Load Pack (fail-closed on pack validation failure)
  // ──────────────────────────────────────────────────────────────────────────
  let pack: OntologyPack;
  try {
    pack = loadPackOrAbstain("SHELL_EXEC");
  } catch (error) {
    if (error instanceof ClarityBurstAbstainError) {
      // Pack validation failed → BLOCK (fail-closed)
      return {
        allowed: false,
        reason:
          error.instructions ||
          "Pack validation failed for SHELL_EXEC. Cannot proceed without valid governance policy.",
      };
    }
    // Unexpected error (unknown stage, etc.) → BLOCK (fail-closed)
    return {
      allowed: false,
      reason: `Unexpected pack loading error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 2: Derive Allowed Contracts & Validate Non-Empty
  // ──────────────────────────────────────────────────────────────────────────
  let allowedContractIds: string[];
  try {
    const caps: RuntimeCapabilities = createFullCapabilities();
    allowedContractIds = deriveAllowedContracts("SHELL_EXEC", pack, caps);
    assertNonEmptyAllowedContracts("SHELL_EXEC", allowedContractIds);
  } catch (error) {
    if (error instanceof ClarityBurstAbstainError) {
      // Empty allowed contracts → BLOCK (fail-closed)
      return {
        allowed: false,
        reason:
          error.instructions ||
          "No contracts are eligible for SHELL_EXEC. Cannot proceed without valid routing targets.",
      };
    }
    // Unexpected error in contract derivation → BLOCK (fail-closed)
    return {
      allowed: false,
      reason: `Unexpected contract derivation error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 3: Route Through ClarityBurst (fail-closed on router outage)
  // ──────────────────────────────────────────────────────────────────────────
  let routeResult: RouterResult;
  try {
    routeResult = await routeClarityBurst({
      stageId: "SHELL_EXEC",
      packId: pack.pack_id,
      packVersion: pack.pack_version,
      allowedContractIds,
      userText: command, // ← The shell command to route
      context: {
        operation: "exec",
        command: command,
      },
      pack, // Include for efficiency
    });
  } catch (error) {
    // Router threw (network error, timeout, etc.) → BLOCK (fail-closed)
    return {
      allowed: false,
      reason: `Router error: ${error instanceof Error ? error.message : String(error)}. Cannot proceed without routing decision.`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 4: Handle Router Result (ok:false = outage → fail-closed)
  // ──────────────────────────────────────────────────────────────────────────
  if (!routeResult.ok) {
    // Router returned error result (outage, disabled, etc.) → BLOCK (fail-closed)
    return {
      allowed: false,
      reason: `Router unavailable: ${routeResult.error}. The operation cannot proceed until the router service is restored.`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 5: Extract Contract ID & Validate Router Mismatch
  // ──────────────────────────────────────────────────────────────────────────
  const contractId = routeResult.data.top1?.contract_id ?? null;

  if (contractId === null) {
    // Router returned no contract → BLOCK (routing failure)
    return {
      allowed: false,
      reason: "Router returned no contract match. The operation cannot proceed without a valid contract.",
    };
  }

  // Validate contract is in allowedContractIds (router mismatch check)
  if (!allowedContractIds.includes(contractId)) {
    // Router mismatch → BLOCK (fail-closed)
    return {
      allowed: false,
      reason: `Router mismatch: contract "${contractId}" not in allowed list [${allowedContractIds.join(", ")}]. The operation cannot proceed.`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUCCESS: Router returned valid contract → PROCEED
  // ──────────────────────────────────────────────────────────────────────────
  return { allowed: true };
}
