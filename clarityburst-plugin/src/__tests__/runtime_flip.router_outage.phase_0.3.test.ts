/**
 * Phase 0.3 Group B — Runtime Flip at Outage Path
 * 
 * "With no env var set, simulate a router outage and confirm a side-effectful op is BLOCKED."
 * 
 * These are PUBLIC API unit tests that:
 * 1. Set NO environment variables
 * 2. Mock routeClarityBurst to throw (simulating router outage)
 * 3. Call applyFileSystemOverrides() (the exported override API) directly
 * 4. Assert the outcome is ABSTAIN_CLARIFY (BLOCKED)
 * 
 * COVERAGE TYPE (per wiring plan Phase 2 distinction):
 * These tests call the override function's PUBLIC API directly — NOT real OpenClaw call sites.
 * applyFileSystemOverrides() currently has ZERO call sites in OpenClaw (that's what Phase 1 and Phase 3 are for).
 * Router outage is simulated via vi.spyOn mocking, following the pattern from existing tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyFileSystemOverrides, type FileSystemContext } from "../decision-override.js";
import * as routerClient from "../router-client.js";

describe("Phase 0.3 Group B — Runtime Flip at Router Outage Path", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save and clear environment
    originalEnv = { ...process.env };
    
    // Ensure NO env vars are set (testing default fail-closed behavior)
    delete process.env.CLARITYBURST_ROUTER_REQUIRED;
    delete process.env.CLARITYBURST_FAIL_OPEN;
    delete process.env.NODE_ENV;
    
    // Set required ClarityBurst config for test execution
    process.env.CLARITYBURST_ROUTER_URL = "http://localhost:3001";
    process.env.CLARITYBURST_ENABLED = "true";
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Public API unit tests: applyFileSystemOverrides() with simulated router outage", () => {
    it("should BLOCK (ABSTAIN_CLARIFY) a side-effectful FILE_SYSTEM_OPS write operation when router is unavailable", async () => {
      // Arrange: Mock router to simulate outage (reusing existing test pattern)
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router connection timeout"));

      // Context for a side-effectful operation (write to file system)
      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",  // ← SIDE-EFFECTFUL operation
        path: "/tmp/test-file.txt",
        userConfirmed: false,
      };

      // Act: Call the public API (applyFileSystemOverrides)
      const result = await applyFileSystemOverrides(context);

      // Assert: Outcome is ABSTAIN_CLARIFY (BLOCKED)
      expect(result.outcome).toBe("ABSTAIN_CLARIFY");
      
      // Assert: Verify blocking details
      if (result.outcome === "ABSTAIN_CLARIFY") {
        expect(result.reason).toBe("ROUTER_UNAVAILABLE");
        expect(result.contractId).toBe(null);
        expect(result.instructions).toContain("Router unavailable");
        expect(result.instructions).toContain("governance-constrained mode");
      }

      // Assert: Router was actually called (proving we went through applyFileSystemOverrides's internal path)
      expect(routerSpy).toHaveBeenCalled();

      routerSpy.mockRestore();
    });

    it("should exercise applyFileSystemOverrides's internal path (pack load → router call → outage handler)", async () => {
      // This test exercises the override function's INTERNAL implementation:
      // applyFileSystemOverrides() → loadPackOrAbstain() → routeClarityBurst() (mocked to throw) →
      // → error handling → handleRouterOutageFailClosed() → ABSTAIN_CLARIFY
      //
      // This is a PUBLIC API unit test, NOT a real OpenClaw call-site integration test.
      // applyFileSystemOverrides() has zero call sites in OpenClaw currently.
      
      // Arrange: Mock router outage
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router unavailable"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
      };

      // Act: Call the exported override API directly
      const result = await applyFileSystemOverrides(context);

      // Assert: The function's internal path was exercised:
      // 1. applyFileSystemOverrides was invoked (public API)
      // 2. Internally loads pack
      // 3. Internally calls routeClarityBurst (which throws due to mock)
      // 4. Error triggers outage handling logic
      // 5. Returns ABSTAIN_CLARIFY outcome
      
      expect(result.outcome).toBe("ABSTAIN_CLARIFY");
      if (result.outcome === "ABSTAIN_CLARIFY") {
        expect(result.reason).toBe("ROUTER_UNAVAILABLE");
      }
      
      // The router client was actually invoked internally (not bypassed)
      expect(routerSpy).toHaveBeenCalled();

      routerSpy.mockRestore();
    });

    it("should verify NO env vars are needed for default fail-closed behavior", async () => {
      // Arrange: Explicitly verify no fail-open/router-required flags are set
      expect(process.env.CLARITYBURST_FAIL_OPEN).toBeUndefined();
      expect(process.env.CLARITYBURST_ROUTER_REQUIRED).toBeUndefined();
      
      // Mock router outage
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router timeout"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",  // side-effectful
        path: "/workspace/file.txt",
      };

      // Act: Call with NO special flags set
      const result = await applyFileSystemOverrides(context);

      // Assert: Should still BLOCK (default is fail-closed for side-effectful ops)
      expect(result.outcome).toBe("ABSTAIN_CLARIFY");
      if (result.outcome === "ABSTAIN_CLARIFY") {
        expect(result.reason).toBe("ROUTER_UNAVAILABLE");
      }

      routerSpy.mockRestore();
    });
  });

  describe("MECHANISM VERIFICATION: How router outage is simulated", () => {
    it("documents the router failure simulation mechanism used by existing ~30 tests", async () => {
      // ANSWER to the task question:
      // "What's the closest-to-real way to simulate 'router outage' here?"
      //
      // ANSWER: The existing tests use vi.spyOn(routerClient, "routeClarityBurst").mockRejectedValue()
      // This is the standard pattern across all router outage tests:
      // - file_system_ops.router_outage.fail_closed.tripwire.test.ts
      // - memory_modify.router_outage.fail_closed.tripwire.test.ts
      // - network_io.router_outage.fail_closed.tripwire.test.ts
      // - router_outage.fail_closed.production_flag.tripwire.test.ts
      // - subagent_spawn.router_outage.fail_closed.tripwire.test.ts
      // - tool_dispatch_gate.router_outage.fail_closed.tripwire.test.ts
      //
      // This test REUSES that exact mechanism rather than inventing a new one.

      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Simulated router outage"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/test.txt",
      };

      const result = await applyFileSystemOverrides(context);

      // Verify the mock was used
      expect(routerSpy).toHaveBeenCalled();
      expect(result.outcome).toBe("ABSTAIN_CLARIFY");

      routerSpy.mockRestore();
    });
  });

  describe("EXPLICIT COVERAGE TYPE STATEMENT", () => {
    it("STATEMENT: These tests call the override PUBLIC API directly, NOT real OpenClaw call sites", async () => {
      // Per the task requirements:
      // "For Group B, be explicit in your report about ONE thing: 
      //  does this test invoke the gate through a real call site, 
      //  or does it call the override function directly with a mocked router result?"
      //
      // ANSWER: Calls the override function's PUBLIC API directly (NOT real call sites)
      //
      // This test calls applyFileSystemOverrides(context) directly from the test code.
      // applyFileSystemOverrides() is the EXPORTED public API from decision-override.ts,
      // but it currently has ZERO call sites in OpenClaw (Phase 1 and Phase 3 will add those).
      //
      // This is PUBLIC API unit test coverage, NOT real-call-site integration coverage.
      // The router failure is simulated via vi.spyOn on routeClarityBurst (standard pattern).
      //
      // The test exercises applyFileSystemOverrides's internal implementation path:
      // - applyFileSystemOverrides is invoked directly by test
      // - Internally loads pack
      // - Internally calls routeClarityBurst (which throws due to mock)
      // - Error handling triggers handleRouterOutageFailClosed internally
      // - Returns ABSTAIN_CLARIFY to test

      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router down"));

      const result = await applyFileSystemOverrides({
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
      });

      expect(result.outcome).toBe("ABSTAIN_CLARIFY");
      expect(routerSpy).toHaveBeenCalled();

      routerSpy.mockRestore();
    });
  });
});
