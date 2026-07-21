/**
 * Router Outage Fail-Closed Default Behavior Tripwire Test
 *
 * Verifies that the NEW default behavior is fail-closed for side-effectful operations
 * when the router is unavailable, with an explicit opt-out via CLARITYBURST_FAIL_OPEN=1.
 *
 * Phase 0.1 Changes:
 * - Default: fail-CLOSED (side-effectful ops → ABSTAIN_CLARIFY on router outage)
 * - Opt-out: CLARITYBURST_FAIL_OPEN=1 → fail-open (side-effectful ops → PROCEED)
 * - Precedence: CLARITYBURST_ROUTER_REQUIRED=1 overrides CLARITYBURST_FAIL_OPEN=1 (fail-closed wins)
 * - Read-only ops: Always proceed on router outage (unchanged)
 *
 * Test coverage:
 * - Default fail-closed: side-effectful write → ABSTAIN_CLARIFY when CLARITYBURST_FAIL_OPEN undefined/not "1"
 * - Fail-closed edge cases: CLARITYBURST_FAIL_OPEN ∈ {"", "0", "true"} → still fail-closed
 * - Opt-out works: CLARITYBURST_FAIL_OPEN="1" → PROCEED
 * - Precedence rule: both flags set → fail-closed wins
 * - Read-only bypass: read operations proceed regardless of flags
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { applyFileSystemOverrides, type FileSystemContext } from "../decision-override.js";
import * as routerClient from "../router-client.js";

describe("Router outage fail-closed DEFAULT behavior (Phase 0.1)", () => {
  beforeEach(() => {
    // Reset environment and mocks
    delete process.env.CLARITYBURST_ROUTER_REQUIRED;
    delete process.env.CLARITYBURST_FAIL_OPEN;
    process.env.CLARITYBURST_ROUTER_URL = "http://localhost:3001";
    process.env.CLARITYBURST_ENABLED = "true";
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up environment
    delete process.env.CLARITYBURST_ROUTER_REQUIRED;
    delete process.env.CLARITYBURST_FAIL_OPEN;
    delete process.env.CLARITYBURST_ROUTER_URL;
    delete process.env.CLARITYBURST_ENABLED;
    vi.restoreAllMocks();
  });

  describe("DEFAULT: fail-closed for side-effectful operations", () => {
    it("should block (ABSTAIN_CLARIFY) when router unavailable and no flags set", async () => {
      // Arrange: No flags set (default fail-closed)
      // (CLARITYBURST_FAIL_OPEN and CLARITYBURST_ROUTER_REQUIRED both undefined)

      // Mock router to throw (unavailable)
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router connection timeout"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
        userConfirmed: false,
      };

      // Act: Call applyFileSystemOverrides with router unavailable
      const result = await applyFileSystemOverrides(context);

      // Assert: Should return ABSTAIN_CLARIFY (NEW default is fail-closed)
      expect(result.outcome).toBe("ABSTAIN_CLARIFY");
      if (result.outcome === "ABSTAIN_CLARIFY") {
        expect(result.reason).toBe("ROUTER_UNAVAILABLE");
        expect(result.contractId).toBe(null);
        expect(result.instructions).toContain("Router unavailable");
        expect(result.instructions).toContain("governance-constrained mode");
      }

      routerSpy.mockRestore();
    });

    it("should block when CLARITYBURST_FAIL_OPEN='' (empty string, not '1')", async () => {
      // Arrange: Set CLARITYBURST_FAIL_OPEN to empty string (not "1")
      process.env.CLARITYBURST_FAIL_OPEN = "";

      // Mock router to throw
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router unavailable"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
        userConfirmed: false,
      };

      // Act
      const result = await applyFileSystemOverrides(context);

      // Assert: Should fail-closed (only "1" enables fail-open)
      expect(result).toMatchObject({
        outcome: "ABSTAIN_CLARIFY",
        contractId: null,
      });

      routerSpy.mockRestore();
    });

    it("should block when CLARITYBURST_FAIL_OPEN='0' (not '1')", async () => {
      // Arrange: Set CLARITYBURST_FAIL_OPEN to '0'
      process.env.CLARITYBURST_FAIL_OPEN = "0";

      // Mock router to throw
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router unavailable"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
        userConfirmed: false,
      };

      // Act
      const result = await applyFileSystemOverrides(context);

      // Assert: Should fail-closed (only "1" enables fail-open)
      expect(result).toMatchObject({
        outcome: "ABSTAIN_CLARIFY",
        contractId: null,
      });

      routerSpy.mockRestore();
    });

    it("should block when CLARITYBURST_FAIL_OPEN='true' (non-standard value, not '1')", async () => {
      // Arrange: Set CLARITYBURST_FAIL_OPEN to non-standard value
      process.env.CLARITYBURST_FAIL_OPEN = "true";

      // Mock router to throw
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router unavailable"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
        userConfirmed: false,
      };

      // Act
      const result = await applyFileSystemOverrides(context);

      // Assert: Should fail-closed (only "1" enables fail-open)
      expect(result).toMatchObject({
        outcome: "ABSTAIN_CLARIFY",
        contractId: null,
      });

      routerSpy.mockRestore();
    });
  });

  describe("OPT-OUT: fail-open with CLARITYBURST_FAIL_OPEN=1", () => {
    it("should proceed when CLARITYBURST_FAIL_OPEN='1' (explicit opt-out)", async () => {
      // Arrange: Set CLARITYBURST_FAIL_OPEN=1 to explicitly enable fail-open
      process.env.CLARITYBURST_FAIL_OPEN = "1";

      // Mock router to throw
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router unavailable"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
        userConfirmed: false,
      };

      // Act
      const result = await applyFileSystemOverrides(context);

      // Assert: Should return PROCEED (fail-open opt-out active)
      expect(result).toMatchObject({
        outcome: "PROCEED",
        contractId: null,
      });

      routerSpy.mockRestore();
    });
  });

  describe("PRECEDENCE: CLARITYBURST_ROUTER_REQUIRED=1 overrides CLARITYBURST_FAIL_OPEN=1", () => {
    it("should block when both flags set (fail-closed wins)", async () => {
      // Arrange: Set BOTH flags
      process.env.CLARITYBURST_FAIL_OPEN = "1";         // wants fail-open
      process.env.CLARITYBURST_ROUTER_REQUIRED = "1";  // wants fail-closed

      // Mock router to throw
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router unavailable"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
        userConfirmed: false,
      };

      // Act
      const result = await applyFileSystemOverrides(context);

      // Assert: Should fail-closed (ROUTER_REQUIRED takes precedence)
      expect(result).toMatchObject({
        outcome: "ABSTAIN_CLARIFY",
        reason: "ROUTER_UNAVAILABLE",
        contractId: null,
      });

      routerSpy.mockRestore();
    });
  });

  describe("READ-ONLY operations always proceed on router outage", () => {
    it("should proceed for read operation when router unavailable (no flags)", async () => {
      // Arrange: No flags set, read-only operation
      // Mock router to throw
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router unavailable"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "read",  // ← READ-ONLY
        path: "/tmp/file.txt",
        userConfirmed: false,
      };

      // Act
      const result = await applyFileSystemOverrides(context);

      // Assert: Should proceed (read-only bypass)
      expect(result).toMatchObject({
        outcome: "PROCEED",
        contractId: null,
      });

      routerSpy.mockRestore();
    });

    it("should proceed for stat operation when router unavailable with ROUTER_REQUIRED=1", async () => {
      // Arrange: ROUTER_REQUIRED=1 set, but stat is read-only
      process.env.CLARITYBURST_ROUTER_REQUIRED = "1";

      // Mock router to throw
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router unavailable"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "stat",  // ← READ-ONLY
        path: "/tmp",
        userConfirmed: false,
      };

      // Act
      const result = await applyFileSystemOverrides(context);

      // Assert: Should proceed (stat is read-only)
      expect(result).toMatchObject({
        outcome: "PROCEED",
        contractId: null,
      });

      routerSpy.mockRestore();
    });
  });

  describe("LEGACY: side-effectful operations with flag=1 (OLD behavior, kept for reference)", () => {
    it("should block when CLARITYBURST_ROUTER_REQUIRED=1 and router unavailable", async () => {
      // Arrange: Set OLD production flag (now redundant but still works)
      process.env.CLARITYBURST_ROUTER_REQUIRED = "1";

      // Mock router to throw (unavailable)
      const routerSpy = vi
        .spyOn(routerClient, "routeClarityBurst")
        .mockRejectedValue(new Error("Router connection timeout"));

      const context: FileSystemContext = {
        stageId: "FILE_SYSTEM_OPS",
        operation: "write",
        path: "/tmp/file.txt",
        userConfirmed: false,
      };

      // Act
      const result = await applyFileSystemOverrides(context);

      // Assert: Should return ABSTAIN_CLARIFY (fail-closed for side-effectful)
      expect(result.outcome).toBe("ABSTAIN_CLARIFY");
      if (result.outcome === "ABSTAIN_CLARIFY") {
        expect(result.reason).toBe("ROUTER_UNAVAILABLE");
        expect(result.contractId).toBe(null);
        expect(result.instructions).toContain("Router unavailable");
      }

      routerSpy.mockRestore();
    });
  });
});
