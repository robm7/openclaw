/**
 * ClarityBurst OpenClaw plugin — Stage 1 (scaffolding + pure router logic).
 *
 * IMPORTANT: This stage deliberately registers NO hooks:
 *   - no before_tool_call
 *   - no reply_dispatch / before_message_write
 *   - no fetch wrapping / global egress interception
 *
 * Hook registration is the next migration stage. Until then this plugin is
 * an inert container for the router logic (decision-override engine, pack
 * registry/loading, evidence scoring, router client, gate-decision modules)
 * and the ontology packs (single source of truth: the calibrated packs
 * formerly at src/ontology-packs/ in the OpenClaw fork).
 */

// Re-export the full router-logic surface so the fork (and later, hook
// handlers registered here) can consume it from one entry point.
// errors.ts re-exports AbstainReason from decision-override (exported below);
// enumerate to avoid TS2308 ambiguity.
export { ClarityBurstAbstainError, ClarityBurstApiKeyRequiredError } from "./src/errors.js";
export * from "./src/stages.js";
// pack-registry's OntologyPack/PackContract are also re-exported by
// decision-override (exported below); enumerate to avoid TS2308 ambiguity.
export {
  type PackThresholds,
  PACK_POLICY_INCOMPLETE,
  PackValidationError,
  PackPolicyIncompleteError,
  getPackForStage,
  validatePackObject,
  getAvailableStageIds,
  getPackCount,
} from "./src/pack-registry.js";
export * from "./src/pack-load.js";
export * from "./src/pack-scoring-phase-a.js";
export * from "./src/allowed-contracts.js";
export * from "./src/router-client.js";
export * from "./src/decision-override.js";
export * from "./src/canonicalize.js";
export * from "./src/user-text-context.js";
export * from "./src/run-metrics.js";
export * from "./src/shell-exec-gate.js";
export * from "./src/ledger-verification.js";
export * from "./src/cron-task.js";
export * from "./src/decision-cron.js";
// cron-preflight-gate's ProceedOutcome collides with decision-override's;
// re-export explicitly under a disambiguated alias.
export {
  CronPreflightGate,
  type EscalateCronStateInvalid,
  type ProceedOutcome as CronPreflightProceedOutcome,
  type CronPreflightOutcome,
} from "./src/cron-preflight-gate.js";
export * from "./src/cron-dispatch-checker.js";
export * from "./src/gates/network-io-gate.js";
export * from "./src/gates/file-system-ops-gate.js";
export * from "./src/gates/cron-schedule-gate.js";
// browser-automate-gate's extractHostname collides with network-io-gate's;
// re-export the rest explicitly.
export {
  gateBrowserAutomate,
  type BrowserAutomateGateDecision,
  type BrowserAutomateAction,
} from "./src/gates/browser-automate-gate.js";

type MinimalPluginApi = {
  logger?: { info?: (message: string) => void };
};

/**
 * Plugin register entry point. Intentionally does nothing beyond a load log.
 * Hook registration is explicitly out of scope for this migration stage.
 */
export default function register(api: MinimalPluginApi): void {
  api?.logger?.info?.(
    "clarityburst plugin loaded (stage 1: router logic only — no hooks registered yet)",
  );
}
