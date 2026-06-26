/**
 * Phase 1 SHELL_EXEC Prove Test — Router Unavailable Blocks Execution
 * 
 * This test proves the wired SHELL_EXEC gate blocks at real call sites when the router is unavailable.
 * Unlike Phase 0.3 tests that call applyShellExecOverrides directly, this drives commands through
 * the actual exec tool execute path and asserts:
 * 1. Blocked result with real reason text
 * 2. No process spawn — the critical assertion proving governance intercepted before execution
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecTool } from "./bash-tools.exec.js";
import { resetProcessRegistryForTests } from "./bash-process-registry.js";

// Spy references to check spawn was never called
let runExecProcessSpy: ReturnType<typeof vi.spyOn>;
let dispatchNodeInvokeGuardedSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // Clear router env vars to force fail-closed
  delete process.env.CLARITYBURST_ROUTER_URL;
  delete process.env.CLARITYBURST_ROUTER_API_KEY;
  
  // Spy on spawn functions — critical assertions will check these were never called
  const execRuntime = await import("./bash-tools.exec-runtime.js");
  runExecProcessSpy = vi.spyOn(execRuntime, "runExecProcess");
  
  const nodeInvokeGuard = await import("./tools/node-invoke-guard.js");
  dispatchNodeInvokeGuardedSpy = vi.spyOn(nodeInvokeGuard, "dispatchNodeInvokeGuarded");
});

afterEach(() => {
  resetProcessRegistryForTests();
  vi.restoreAllMocks();
  
  // Restore env vars
  delete process.env.CLARITYBURST_ROUTER_URL;
  delete process.env.CLARITYBURST_ROUTER_API_KEY;
});

describe("SHELL_EXEC gate blocks execution when router unavailable", () => {
  it("blocks sandbox/gateway exec and never spawns process", async () => {
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
    });

    const result = await tool.execute("test-call", {
      command: "echo 'this should never run'",
    });

    // Assert blocked result
    expect(result.details.status).toBe("failed");
    
    // Assert real block reason (not empty, not generic fallback)
    const text = result.content?.find((item) => item.type === "text")?.text ?? "";
    expect(text).toBeTruthy();
    expect(text).toContain("ClarityBurst router"); // Real router-unavailable text
    expect(text).not.toBe("Command blocked"); // Not the generic fallback
    
    // CRITICAL: Assert no spawn — proves governance intercepted before execution
    expect(runExecProcessSpy).not.toHaveBeenCalled();
  });

  it("blocks default (sandbox fallback) exec path", async () => {
    // Default host falls back to sandbox when sandbox runtime is available
    const tool = createExecTool({
      security: "full",
      ask: "off",
    });

    const result = await tool.execute("test-call", {
      command: "echo 'this should never run'",
    });

    // Assert blocked result
    expect(result.details.status).toBe("failed");
    
    // Assert real block reason
    const text = result.content?.find((item) => item.type === "text")?.text ?? "";
    expect(text).toBeTruthy();
    expect(text).toContain("ClarityBurst router");
    
    // CRITICAL: Neither spawn function should be called
    expect(runExecProcessSpy).not.toHaveBeenCalled();
    expect(dispatchNodeInvokeGuardedSpy).not.toHaveBeenCalled();
  });
});
