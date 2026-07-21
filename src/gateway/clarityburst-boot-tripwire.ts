/**
 * ClarityBurst fail-closed boot tripwire.
 *
 * WHY THIS EXISTS (see FORK_AUDIT_FAILCLOSED_HAZARDS.md):
 * OpenClaw's plugin system fails OPEN on every plugin failure mode — disabled
 * config, denylist, missing allowlist entry, load/eval error, invalid config,
 * a throwing register(), and (silently) a plugin that is not installed at all.
 * The loader catches all errors, records status:"error"/"disabled", logs, and
 * boot proceeds fully functional and completely ungated.
 *
 * This module is intentionally THE ONLY fork-side enforcement mechanism.
 * All actual gating routes through the ClarityBurst plugin's own hooks
 * (before_tool_call, reply_dispatch, globalThis.fetch wrap). This tripwire's
 * sole job is: refuse to boot the gateway if that plugin is not loaded and
 * active. It is fail-closed by construction — any uncertainty (missing record,
 * unexpected registry shape, lookup throwing) is treated as "not active" and
 * the process exits before the gateway accepts connections.
 */

export const CLARITYBURST_PLUGIN_ID =
  process.env.CLARITYBURST_PLUGIN_ID?.trim() || "clarityburst";

type PluginRecordLike = {
  id?: unknown;
  enabled?: unknown;
  status?: unknown;
  error?: unknown;
};

type PluginRegistryLike = {
  plugins?: unknown;
};

export type TripwireDeps = {
  logError: (msg: string) => void;
  logWarn: (msg: string) => void;
  exit: (code: number) => never;
};

const defaultDeps: TripwireDeps = {
  // eslint-disable-next-line no-console
  logError: (msg) => console.error(msg),
  // eslint-disable-next-line no-console
  logWarn: (msg) => console.warn(msg),
  exit: (code) => process.exit(code) as never,
};

/**
 * Test-only bypass. Deliberately narrow to prevent env-based fail-open:
 * - VITEST must be exactly "true" (vitest's own truthy convention; "1",
 *   "0", or any other non-empty value does NOT qualify), AND
 * - OPENCLAW_TEST_MINIMAL_GATEWAY must be exactly "1" (mirrors the
 *   minimalTestGateway two-variable requirement in server.impl.ts).
 * When the bypass applies it is never silent: a visible warning is logged.
 */
export function shouldBypassTripwireForTests(env: NodeJS.ProcessEnv): boolean {
  return env.VITEST === "true" && env.OPENCLAW_TEST_MINIMAL_GATEWAY === "1";
}

function fatal(deps: TripwireDeps, detail: string): void {
  deps.logError(
    [
      "FATAL: ClarityBurst gating plugin is required but not active.",
      `Detail: ${detail}`,
      "",
      "OpenClaw's plugin system fails open on any plugin failure; this fork",
      "refuses to boot the gateway without active gating (fail-closed).",
      `Expected plugin id: "${CLARITYBURST_PLUGIN_ID}" with status "loaded" and enabled=true.`,
      "Fix: install/enable the ClarityBurst plugin (plugins.entries." +
        CLARITYBURST_PLUGIN_ID +
        ".enabled=true), then restart.",
    ].join("\n"),
  );
  deps.exit(1);
}

/**
 * Assert the ClarityBurst gating plugin is loaded and active in the given
 * plugin registry, or exit(1). Fail-closed: any exception, missing record,
 * or unexpected shape is treated as "not active".
 */
export function assertClarityBurstPluginActive(
  registry: PluginRegistryLike | null | undefined,
  deps: TripwireDeps = defaultDeps,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (shouldBypassTripwireForTests(env)) {
    deps.logWarn(
      "WARNING: ClarityBurst fail-closed boot tripwire BYPASSED for tests " +
        '(VITEST="true" and OPENCLAW_TEST_MINIMAL_GATEWAY="1"). ' +
        "Gating enforcement is NOT active in this process. " +
        "This must never appear in a production deployment.",
    );
    return;
  }
  let failureDetail: string | null;
  try {
    failureDetail = findFailure(registry);
  } catch (err) {
    // Fail-closed: an unexpected error during the check itself means we
    // cannot prove gating is active, so we must not proceed.
    failureDetail = `tripwire check threw unexpectedly: ${String(err)}`;
  }
  if (failureDetail !== null) {
    fatal(deps, failureDetail);
  }
}

/** Returns a failure detail string, or null when the plugin is active. */
function findFailure(registry: PluginRegistryLike | null | undefined): string | null {
  if (!registry || typeof registry !== "object") {
    return "plugin registry is missing or not an object";
  }
  const plugins = registry.plugins;
  if (!Array.isArray(plugins)) {
    return "plugin registry has no plugins array (unexpected shape)";
  }
  const record = plugins.find(
    (entry): entry is PluginRecordLike =>
      Boolean(entry) &&
      typeof entry === "object" &&
      (entry as PluginRecordLike).id === CLARITYBURST_PLUGIN_ID,
  );
  if (!record) {
    return `plugin "${CLARITYBURST_PLUGIN_ID}" not found in registry (not installed?)`;
  }
  if (record.status !== "loaded" || record.enabled !== true) {
    const reason = typeof record.error === "string" && record.error ? ` (${record.error})` : "";
    return (
      `plugin "${CLARITYBURST_PLUGIN_ID}" present but not active: ` +
      `status=${String(record.status)} enabled=${String(record.enabled)}${reason}`
    );
  }
  return null;
}
