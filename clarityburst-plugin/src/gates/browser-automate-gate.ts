/**
 * BROWSER_AUTOMATE gate — routing half (split out of the fork's
 * src/clarityburst/browser-automate-gating.ts per FORK_AUDIT_HOOK_MAPPING.md).
 *
 * Plugin side (this module): action/target signal extraction from browser
 * params, BROWSER_AUTOMATE routing via applyBrowserAutomateOverrides(),
 * abstain mapping.
 *
 * OpenClaw side (remains in the fork): the Playwright page.goto/click/fill/
 * press/evaluate execution — run by call sites on PROCEED. That half gets
 * wired to the hook's PROCEED branch in the next stage. This module has NO
 * playwright-core dependency.
 */

import { ClarityBurstAbstainError } from "../errors.js";
import { applyBrowserAutomateOverrides, type BrowserAutomateContext } from "../decision-override.js";
import { createSubsystemLogger } from "../internal/logging.js";

const gatingLog = createSubsystemLogger("clarityburst-browser-automate-gate");

export type BrowserAutomateGateDecision = Awaited<
  ReturnType<typeof applyBrowserAutomateOverrides>
>;

export type BrowserAutomateAction = "navigate" | "click" | "fill" | "press" | "evaluate";

/** Extract hostname from a URL for routing/logging (signal extraction). */
export function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

/**
 * Route a browser-automation action through the BROWSER_AUTOMATE gate.
 * Throws ClarityBurstAbstainError on ABSTAIN_CONFIRM / ABSTAIN_CLARIFY.
 * Returns the gate decision on PROCEED. Performs NO browser action itself.
 */
export async function gateBrowserAutomate(input: {
  action: BrowserAutomateAction;
  /** Target or current page URL (full URL; hostname is extracted for routing). */
  url: string;
  /** Element selector for click/fill/press actions. */
  selector?: string;
  userConfirmed?: boolean;
}): Promise<BrowserAutomateGateDecision> {
  const hostname = extractHostname(input.url);

  const context: BrowserAutomateContext = {
    stageId: "BROWSER_AUTOMATE",
    action: input.action,
    url: hostname,
    ...(input.selector !== undefined ? { selector: input.selector } : {}),
    userConfirmed: input.userConfirmed ?? false,
  } as BrowserAutomateContext;

  const gateResult = await applyBrowserAutomateOverrides(context);

  gatingLog.debug("BROWSER_AUTOMATE gate decision", {
    contractId: gateResult.contractId,
    outcome: gateResult.outcome,
    action: input.action,
    url: hostname,
    selector: input.selector,
  });

  if (gateResult.outcome === "ABSTAIN_CONFIRM" || gateResult.outcome === "ABSTAIN_CLARIFY") {
    gatingLog.warn("BROWSER_AUTOMATE gate blocked action", {
      contractId: gateResult.contractId,
      reason: gateResult.reason,
      action: input.action,
      url: hostname,
    });
    throw new ClarityBurstAbstainError({
      stageId: "BROWSER_AUTOMATE",
      outcome: gateResult.outcome,
      reason: gateResult.reason as never,
      contractId: gateResult.contractId,
      instructions:
        gateResult.instructions ??
        `Browser ${input.action} on ${hostname} blocked by ClarityBurst BROWSER_AUTOMATE gate.`,
    });
  }

  gatingLog.debug("BROWSER_AUTOMATE gate approved action", {
    contractId: gateResult.contractId,
    action: input.action,
    url: hostname,
  });

  return gateResult;
}
