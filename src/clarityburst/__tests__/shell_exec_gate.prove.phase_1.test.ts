/**
 * Phase 1 Shell Exec Gate Integration Test
 *
 * PROOF: Shell exec gate intercepts commands BEFORE spawn, returning blocked result
 * when router is unavailable (fail-closed behavior).
 *
 * METHOD: Mock spawn functions, force router outage, drive real execute path,
 * assert blocked result AND zero spawn calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createExecTool } from "../../agents/bash-tools.exec.ts";
import * as packLoad from "../pack-load.js";
import * as routerClient from "../router-client.js";

// ──────────────────────────────────────────────────────────────────────────
// MOCK CONFIG MANAGER: Bypass config validation so gate reaches router path
// ──────────────────────────────────────────────────────────────────────────
vi.mock("../config.js", () => ({
  default: {
    isEnabled: vi.fn().mockReturnValue(true),
    getRouterUrl: vi.fn().mockReturnValue("http://test-router.local"),
    getTimeoutMs: vi.fn().mockReturnValue(5000),
  },
}));

// ──────────────────────────────────────────────────────────────────────────
// MOCK SPAWN FUNCTIONS: These should NEVER be called when gate blocks
// ──────────────────────────────────────────────────────────────────────────

// FIX 1: Use .js extension to match actual import specifiers in bash-tools.exec.ts (line 28)
vi.mock("../../agents/bash-tools.exec-runtime.js", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    runExecProcess: vi.fn().mockResolvedValue({
      session: { id: "mock-session", command: "mock", cwd: ".", aggregated: "" },
      startedAt: Date.now(),
      promise: Promise.resolve({
        status: "completed",
        exitCode: 0,
        exitSignal: null,
        durationMs: 0,
        aggregated: "SHOULD_NOT_REACH_HERE",
        timedOut: false,
      }),
      kill: vi.fn(),
    }),
  };
});

// FIX 1: Use .js extension to match actual import specifiers in bash-tools.exec-host-node.ts (line 30)
vi.mock("../../agents/tools/node-invoke-guard.js", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    dispatchNodeInvokeGuarded: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock gateway tools to prevent websocket connection attempts in node path tests
vi.mock("../../agents/tools/nodes-utils.js", () => ({
  listNodes: vi
    .fn()
    .mockResolvedValue([
      {
        nodeId: "test-node",
        name: "test-node",
        status: "online",
        commands: ["system.run"],
        platform: "linux",
      },
    ]),
  resolveNodeIdFromList: vi.fn().mockReturnValue("test-node"),
}));

// Mock capability system to allow all contracts through (no filtering)
vi.mock("../allowed-contracts.js", () => ({
  createFullCapabilities: vi.fn().mockReturnValue({}),
  deriveAllowedContracts: vi.fn().mockImplementation((_stageId, pack, _caps) => {
    // Return all contract IDs from the pack (no capability filtering)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return pack.contracts.map((c: any) => c.contract_id);
  }),
  assertNonEmptyAllowedContracts: vi.fn().mockImplementation(() => {
    // No-op - never throw
  }),
}));

describe("Phase 1 Shell Exec Gate - Proof Test", () => {
  // FIX 3: Mock loadPackOrAbstain to return a valid SHELL_EXEC pack
  // so the gate reaches the router path (not blocked earlier by pack-missing)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _packLoadSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Return a minimal valid SHELL_EXEC pack
    _packLoadSpy = vi.spyOn(packLoad, "loadPackOrAbstain").mockReturnValue({
      pack_id: "test.shell_exec",
      pack_version: "1.0.0",
      stage_id: "SHELL_EXEC",
      description: "Test pack",
      contracts: [
        {
          contract_id: "EXECUTE_COMMAND",
          risk_class: "CRITICAL",
          required_fields: [],
          limits: null,
          needs_confirmation: false,
          deny_by_default: true,
          capability_requirements: null,
        },
      ],
      thresholds: {
        min_confidence_T: 0.7,
        dominance_margin_Delta: 0.15,
      },
      field_schema: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sandbox path: blocks command and prevents runExecProcess call when router returns ok:false", async () => {
    // Import the mocked functions to assert on them
    const { runExecProcess } = await import("../../agents/bash-tools.exec-runtime.js");
    const runExecProcessMock = vi.mocked(runExecProcess);

    // Force router unavailable (fail-closed)
    const routeSpy = vi.spyOn(routerClient, "routeClarityBurst").mockResolvedValue({
      ok: false,
      error: "Router service unavailable",
    });

    // Create real exec tool with sandbox host
    const execTool = createExecTool({
      host: "sandbox",
      sandbox: {
        enabled: true,
        containerName: "test-sandbox",
        root: "/workspace",
      },
      cwd: "/workspace",
      allowBackground: false,
    });

    // Drive command through real execute path
    const result = await execTool.execute(
      "test-call-id",
      {
        command: "echo test",
        workdir: "/workspace",
      },
      new AbortController().signal,
      undefined,
    );

    // ────────────────────────────────────────────────────────────────────
    // ASSERTION 1: Blocked result with meaningful router-unavailable reason
    // ────────────────────────────────────────────────────────────────────
    expect(result.details?.status).toBe("failed");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const blockText = result.content[0].text;
    expect(blockText).toBeTruthy();
    expect(blockText).toContain("Router unavailable");
    expect(blockText).toContain("Router service unavailable");

    // ────────────────────────────────────────────────────────────────────
    // ASSERTION 2: runExecProcess was NEVER called (proves interception)
    // ────────────────────────────────────────────────────────────────────
    expect(runExecProcessMock).not.toHaveBeenCalled();

    // Cleanup
    routeSpy.mockRestore();
  });

  // FIX 2: Add test for router throwing (mockRejectedValue) - different code path
  it("sandbox path: blocks command and prevents runExecProcess call when router throws", async () => {
    // Import the mocked functions to assert on them
    const { runExecProcess } = await import("../../agents/bash-tools.exec-runtime.js");
    const runExecProcessMock = vi.mocked(runExecProcess);

    // Force router to throw (network error, timeout, etc.)
    const routeSpy = vi
      .spyOn(routerClient, "routeClarityBurst")
      .mockRejectedValue(new Error("Network timeout"));

    // Create real exec tool with sandbox host
    const execTool = createExecTool({
      host: "sandbox",
      sandbox: {
        enabled: true,
        containerName: "test-sandbox",
        root: "/workspace",
      },
      cwd: "/workspace",
      allowBackground: false,
    });

    // Drive command through real execute path
    const result = await execTool.execute(
      "test-call-id",
      {
        command: "echo test",
        workdir: "/workspace",
      },
      new AbortController().signal,
      undefined,
    );

    // ────────────────────────────────────────────────────────────────────
    // ASSERTION 1: Blocked result with meaningful router error reason
    // ────────────────────────────────────────────────────────────────────
    expect(result.details?.status).toBe("failed");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const blockText = result.content[0].text;
    expect(blockText).toBeTruthy();
    expect(blockText).toContain("Router error");
    expect(blockText).toContain("Network timeout");

    // ────────────────────────────────────────────────────────────────────
    // ASSERTION 2: runExecProcess was NEVER called (proves interception)
    // ────────────────────────────────────────────────────────────────────
    expect(runExecProcessMock).not.toHaveBeenCalled();

    // Cleanup
    routeSpy.mockRestore();
  });

  it("node path: blocks command and prevents dispatchNodeInvokeGuarded call when router returns ok:false", async () => {
    // Import the mocked functions to assert on them
    const { dispatchNodeInvokeGuarded } = await import("../../agents/tools/node-invoke-guard.js");
    const dispatchMock = vi.mocked(dispatchNodeInvokeGuarded);

    // Force router unavailable (fail-closed)
    const routeSpy = vi.spyOn(routerClient, "routeClarityBurst").mockResolvedValue({
      ok: false,
      error: "Router service unavailable",
    });

    // Create real exec tool with node host
    const execTool = createExecTool({
      host: "node",
      cwd: "/workspace",
      allowBackground: false,
      security: "allowlist",
      ask: "off",
    });

    // Drive command through real execute path
    const result = await execTool.execute(
      "test-call-id",
      {
        command: "echo test",
        workdir: "/workspace",
        host: "node",
        node: "test-node",
      },
      new AbortController().signal,
      undefined,
    );

    // ────────────────────────────────────────────────────────────────────
    // ASSERTION 1: Blocked result with meaningful router-unavailable reason
    // ────────────────────────────────────────────────────────────────────
    expect(result.details?.status).toBe("failed");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const blockText = result.content[0].text;
    expect(blockText).toBeTruthy();
    expect(blockText).toContain("Router unavailable");
    expect(blockText).toContain("Router service unavailable");

    // ────────────────────────────────────────────────────────────────────
    // ASSERTION 2: dispatchNodeInvokeGuarded was NEVER called (proves interception)
    // ────────────────────────────────────────────────────────────────────
    expect(dispatchMock).not.toHaveBeenCalled();

    // Cleanup
    routeSpy.mockRestore();
  });

  // FIX 2: Add test for router throwing (mockRejectedValue) on node path
  it("node path: blocks command and prevents dispatchNodeInvokeGuarded call when router throws", async () => {
    // Import the mocked functions to assert on them
    const { dispatchNodeInvokeGuarded } = await import("../../agents/tools/node-invoke-guard.js");
    const dispatchMock = vi.mocked(dispatchNodeInvokeGuarded);

    // Force router to throw (network error, timeout, etc.)
    const routeSpy = vi
      .spyOn(routerClient, "routeClarityBurst")
      .mockRejectedValue(new Error("Network timeout"));

    // Create real exec tool with node host
    const execTool = createExecTool({
      host: "node",
      cwd: "/workspace",
      allowBackground: false,
      security: "allowlist",
      ask: "off",
    });

    // Drive command through real execute path
    const result = await execTool.execute(
      "test-call-id",
      {
        command: "echo test",
        workdir: "/workspace",
        host: "node",
        node: "test-node",
      },
      new AbortController().signal,
      undefined,
    );

    // ────────────────────────────────────────────────────────────────────
    // ASSERTION 1: Blocked result with meaningful router error reason
    // ────────────────────────────────────────────────────────────────────
    expect(result.details?.status).toBe("failed");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const blockText = result.content[0].text;
    expect(blockText).toBeTruthy();
    expect(blockText).toContain("Router error");
    expect(blockText).toContain("Network timeout");

    // ────────────────────────────────────────────────────────────────────
    // ASSERTION 2: dispatchNodeInvokeGuarded was NEVER called (proves interception)
    // ────────────────────────────────────────────────────────────────────
    expect(dispatchMock).not.toHaveBeenCalled();

    // Cleanup
    routeSpy.mockRestore();
  });

  // ────────────────────────────────────────────────────────────────────
  // POSITIVE CONTROL: Verify mocks are live (not vacuous)
  // ────────────────────────────────────────────────────────────────────
  it("positive control: runExecProcess IS called when router allows (proves mock is wired)", async () => {
    // Import the mocked functions to assert on them
    const { runExecProcess } = await import("../../agents/bash-tools.exec-runtime.js");
    const runExecProcessMock = vi.mocked(runExecProcess);

    // Make router return SUCCESS with matching contract
    const routeSpy = vi.spyOn(routerClient, "routeClarityBurst").mockResolvedValue({
      ok: true,
      data: {
        top1: { contract_id: "EXECUTE_COMMAND", score: 0.99 },
        top2: { contract_id: "OTHER_CONTRACT", score: 0.1 },
      },
    });

    // Create real exec tool with sandbox host
    const execTool = createExecTool({
      host: "sandbox",
      sandbox: {
        enabled: true,
        containerName: "test-sandbox",
        root: "/workspace",
      },
      cwd: "/workspace",
      allowBackground: false,
    });

    // Drive command through real execute path
    const result = await execTool.execute(
      "test-call-id",
      {
        command: "echo test",
        workdir: "/workspace",
      },
      new AbortController().signal,
      undefined,
    );

    // ────────────────────────────────────────────────────────────────────
    // POSITIVE ASSERTION: runExecProcess WAS called (proves gate allowed through)
    // ────────────────────────────────────────────────────────────────────
    expect(runExecProcessMock).toHaveBeenCalled();

    // Verify it returned the mocked success result (not blocked)
    expect(result.details?.status).not.toBe("failed");

    // Cleanup
    routeSpy.mockRestore();
  });
});
