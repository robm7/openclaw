import process from "node:process";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";

export type RuntimeKind = "node" | "unknown";

type Semver = {
  major: number;
  minor: number;
  patch: number;
};

const MIN_NODE: Semver = { major: 22, minor: 12, patch: 0 };

export type RuntimeDetails = {
  kind: RuntimeKind;
  version: string | null;
  execPath: string | null;
  pathEnv: string;
};

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

export function parseSemver(version: string | null): Semver | null {
  if (!version) {
    return null;
  }
  const match = version.match(SEMVER_RE);
  if (!match) {
    return null;
  }
  const [, major, minor, patch] = match;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

export function isAtLeast(version: Semver | null, minimum: Semver): boolean {
  if (!version) {
    return false;
  }
  if (version.major !== minimum.major) {
    return version.major > minimum.major;
  }
  if (version.minor !== minimum.minor) {
    return version.minor > minimum.minor;
  }
  return version.patch >= minimum.patch;
}

export function detectRuntime(): RuntimeDetails {
  const kind: RuntimeKind = process.versions?.node ? "node" : "unknown";
  const version = process.versions?.node ?? null;

  return {
    kind,
    version,
    execPath: process.execPath ?? null,
    pathEnv: process.env.PATH ?? "(not set)",
  };
}

export function runtimeSatisfies(details: RuntimeDetails): boolean {
  const parsed = parseSemver(details.version);
  if (details.kind === "node") {
    return isAtLeast(parsed, MIN_NODE);
  }
  return false;
}

export function isSupportedNodeVersion(version: string | null): boolean {
  return isAtLeast(parseSemver(version), MIN_NODE);
}

export function assertSupportedRuntime(
  runtime: RuntimeEnv = defaultRuntime,
  details: RuntimeDetails = detectRuntime(),
): void {
  if (runtimeSatisfies(details)) {
    return;
  }

  const versionLabel = details.version ?? "unknown";
  const runtimeLabel =
    details.kind === "unknown" ? "unknown runtime" : `${details.kind} ${versionLabel}`;
  const execLabel = details.execPath ?? "unknown";

  runtime.error(
    [
      "openclaw requires Node >=22.12.0.",
      `Detected: ${runtimeLabel} (exec: ${execLabel}).`,
      `PATH searched: ${details.pathEnv}`,
      "Install Node: https://nodejs.org/en/download",
      "Upgrade Node and re-run openclaw.",
    ].join("\n"),
  );
  runtime.exit(1);
}

/**
 * Assert that fail-open mode is not active in production environments.
 * 
 * Fail-open mode (CLARITYBURST_FAIL_OPEN=1 without CLARITYBURST_ROUTER_REQUIRED=1)
 * allows side-effectful operations to proceed when the ClarityBurst router is unavailable.
 * This is unsafe in production and must be blocked at boot time.
 * 
 * @throws {Error} When NODE_ENV=production and fail-open is active
 */
export function assertProductionFailClosedMode(): void {
  const nodeEnv = process.env.NODE_ENV;
  const failOpen = process.env.CLARITYBURST_FAIL_OPEN;
  const routerRequired = process.env.CLARITYBURST_ROUTER_REQUIRED;

  // Fail-open is active when CLARITYBURST_FAIL_OPEN=1 AND CLARITYBURST_ROUTER_REQUIRED≠1
  // (ROUTER_REQUIRED=1 takes precedence and forces fail-closed)
  const failOpenIsActive = failOpen === "1" && routerRequired !== "1";

  if (nodeEnv === "production" && failOpenIsActive) {
    throw new Error(
      [
        "openclaw: Cannot start in production with fail-open mode active.",
        "",
        "Fail-open mode allows side-effectful operations to proceed when the ClarityBurst",
        "router is unavailable. This is unsafe in production environments.",
        "",
        "Current configuration:",
        `  NODE_ENV=${nodeEnv || "(not set)"}`,
        `  CLARITYBURST_FAIL_OPEN=${failOpen || "(not set)"}`,
        `  CLARITYBURST_ROUTER_REQUIRED=${routerRequired || "(not set)"}`,
        "",
        "To fix, choose ONE of:",
        "  1. Unset CLARITYBURST_FAIL_OPEN (recommended: removes fail-open mode)",
        "  2. Set CLARITYBURST_ROUTER_REQUIRED=1 (forces fail-closed, overrides fail-open)",
      ].join("\n"),
    );
  }
}
