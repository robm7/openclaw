/**
 * FILE_SYSTEM_OPS gate — routing half (split out of the fork's
 * src/clarityburst/file-system-ops-gating.ts per FORK_AUDIT_HOOK_MAPPING.md).
 *
 * Plugin side (this module): path/size signal extraction, FILE_SYSTEM_OPS
 * routing via applyFileSystemOverrides(), abstain handling.
 *
 * OpenClaw side (remains in the fork): the fs write/append/mkdir call itself —
 * call sites perform their own write on PROCEED. That half gets wired to the
 * hook's PROCEED branch in the next stage.
 */

import { ClarityBurstAbstainError } from "../errors.js";
import { applyFileSystemOverrides, type FileSystemContext } from "../decision-override.js";
import { createSubsystemLogger } from "../internal/logging.js";

const gatingLog = createSubsystemLogger("clarityburst-file-system-ops-gate");

export type FileSystemGateDecision = Awaited<ReturnType<typeof applyFileSystemOverrides>>;

export type FileSystemGateInput = Omit<FileSystemContext, "stageId" | "userConfirmed"> & {
  userConfirmed?: boolean;
};

/** Compute byte size for write/append payloads (signal extraction). */
export function extractPayloadSize(data: string | Uint8Array, encoding?: BufferEncoding): number {
  return typeof data === "string" ? Buffer.byteLength(data, encoding ?? "utf8") : data.length;
}

/**
 * Route a filesystem mutation through the FILE_SYSTEM_OPS gate.
 * Throws ClarityBurstAbstainError on ABSTAIN_CONFIRM / ABSTAIN_CLARIFY.
 * Returns the gate decision on PROCEED. Performs NO filesystem I/O itself.
 */
export async function gateFileSystemOp(
  input: FileSystemGateInput,
): Promise<FileSystemGateDecision> {
  const context: FileSystemContext = {
    ...input,
    stageId: "FILE_SYSTEM_OPS",
    userConfirmed: input.userConfirmed ?? false,
  } as FileSystemContext;

  const gateResult = await applyFileSystemOverrides(context);

  gatingLog.debug("FILE_SYSTEM_OPS gate decision", {
    contractId: gateResult.contractId,
    outcome: gateResult.outcome,
    operation: (context as { operation?: string }).operation,
    path: (context as { path?: string }).path,
  });

  if (gateResult.outcome === "ABSTAIN_CONFIRM" || gateResult.outcome === "ABSTAIN_CLARIFY") {
    gatingLog.warn("FILE_SYSTEM_OPS gate blocked operation", {
      contractId: gateResult.contractId,
      reason: gateResult.reason,
      path: (context as { path?: string }).path,
    });
    throw new ClarityBurstAbstainError({
      stageId: "FILE_SYSTEM_OPS",
      outcome: gateResult.outcome,
      reason: (gateResult.reason ?? "PACK_POLICY_INCOMPLETE") as never,
      contractId: gateResult.contractId ?? null,
      instructions:
        gateResult.instructions ??
        `File system operation on ${(context as { path?: string }).path} blocked by ClarityBurst FILE_SYSTEM_OPS gate.`,
    });
  }

  gatingLog.debug("FILE_SYSTEM_OPS gate approved operation", {
    contractId: gateResult.contractId,
    path: (context as { path?: string }).path,
  });

  return gateResult;
}
