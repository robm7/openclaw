/**
 * CRON_SCHEDULE gate — routing half (split out of the fork's
 * src/clarityburst/cron-schedule-gating.ts per FORK_AUDIT_HOOK_MAPPING.md).
 *
 * Plugin side (this module): schedule/operation signal extraction,
 * CRON_SCHEDULE routing via applyCronScheduleOverrides(), abstain mapping.
 *
 * OpenClaw side (remains in the fork): the actual cron job
 * add/update/enable/persist calls — executed by call sites on PROCEED.
 * That half gets wired to the hook's PROCEED branch in the next stage.
 */

import { ClarityBurstAbstainError } from "../errors.js";
import { applyCronScheduleOverrides, type CronScheduleContext } from "../decision-override.js";
import { createSubsystemLogger } from "../internal/logging.js";

const gatingLog = createSubsystemLogger("clarityburst-cron-schedule-gate");

export type CronScheduleGateDecision = Awaited<ReturnType<typeof applyCronScheduleOverrides>>;

export type CronScheduleTaskType = "cron_create" | "cron_update" | "cron_set_enabled";

/**
 * Extract a human-readable schedule summary from a cron job's schedule field
 * (signal extraction — mirrors the fork's extractScheduleSummary behavior).
 */
export function extractScheduleSummary(schedule: unknown): string {
  if (schedule === null || schedule === undefined) {
    return "unknown";
  }
  if (typeof schedule === "string") {
    return schedule;
  }
  if (typeof schedule === "object") {
    const s = schedule as Record<string, unknown>;
    if (typeof s.expr === "string") {
      return s.expr;
    }
    if (typeof s.kind === "string") {
      return String(s.kind);
    }
    try {
      return JSON.stringify(schedule);
    } catch {
      return "unknown";
    }
  }
  return String(schedule);
}

/**
 * Route a cron-schedule mutation through the CRON_SCHEDULE gate.
 * Throws ClarityBurstAbstainError on ABSTAIN_CONFIRM / ABSTAIN_CLARIFY.
 * Returns the gate decision on PROCEED. Performs NO cron mutation itself.
 */
export async function gateCronSchedule(input: {
  taskType: CronScheduleTaskType;
  target: string;
  schedule?: string;
  userConfirmed?: boolean;
}): Promise<CronScheduleGateDecision> {
  const context: CronScheduleContext = {
    stageId: "CRON_SCHEDULE",
    userConfirmed: input.userConfirmed ?? false,
    schedule: input.schedule,
    taskType: input.taskType,
    target: input.target,
  } as CronScheduleContext;

  const gateResult = await applyCronScheduleOverrides(context);

  gatingLog.debug("CRON_SCHEDULE gate decision", {
    ontology: "CRON_SCHEDULE",
    contractId: gateResult.contractId,
    outcome: gateResult.outcome,
    taskType: input.taskType,
    target: input.target,
    schedule: input.schedule,
  });

  if (gateResult.outcome === "ABSTAIN_CONFIRM" || gateResult.outcome === "ABSTAIN_CLARIFY") {
    gatingLog.warn("CRON_SCHEDULE gate blocked operation", {
      ontology: "CRON_SCHEDULE",
      contractId: gateResult.contractId,
      reason: gateResult.reason,
      taskType: input.taskType,
      target: input.target,
    });
    throw new ClarityBurstAbstainError({
      stageId: "CRON_SCHEDULE",
      outcome: gateResult.outcome,
      reason: gateResult.reason as never,
      contractId: gateResult.contractId,
      instructions:
        gateResult.instructions ??
        `Cron ${input.taskType} for "${input.target}" (schedule: ${input.schedule ?? "n/a"}) blocked by ClarityBurst CRON_SCHEDULE gate.`,
    });
  }

  gatingLog.debug("CRON_SCHEDULE gate approved operation", {
    ontology: "CRON_SCHEDULE",
    contractId: gateResult.contractId,
    taskType: input.taskType,
    target: input.target,
  });

  return gateResult;
}
