/**
 * Phase 0.3 Group A — Boot Guard Tests
 * 
 * Unit tests for assertProductionFailClosedMode() to prove the precedence table.
 * Tests directly manipulate process.env to verify each case.
 * 
 * Precedence table being tested:
 * 1. NODE_ENV=production + CLARITYBURST_FAIL_OPEN=1 + CLARITYBURST_ROUTER_REQUIRED unset → throws
 * 2. NODE_ENV=production + CLARITYBURST_FAIL_OPEN=1 + CLARITYBURST_ROUTER_REQUIRED=1 → does NOT throw
 * 3. NODE_ENV not production + CLARITYBURST_FAIL_OPEN=1 → does NOT throw  
 * 4. NODE_ENV=production + no fail-open flags → does NOT throw
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertProductionFailClosedMode } from "../runtime-guard.js";

describe("Phase 0.3 Group A — Boot Guard (assertProductionFailClosedMode)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Clear relevant env vars to start from clean state
    delete process.env.NODE_ENV;
    delete process.env.CLARITYBURST_FAIL_OPEN;
    delete process.env.CLARITYBURST_ROUTER_REQUIRED;
  });

  afterEach(() => {
    // Restore original environment to prevent test leakage
    process.env = originalEnv;
  });

  describe("Case 1: NODE_ENV=production + CLARITYBURST_FAIL_OPEN=1 + CLARITYBURST_ROUTER_REQUIRED unset → throws", () => {
    it("should throw with detailed error message containing actual var values", () => {
      // Arrange: Set the exact configuration that should throw
      process.env.NODE_ENV = "production";
      process.env.CLARITYBURST_FAIL_OPEN = "1";
      // CLARITYBURST_ROUTER_REQUIRED intentionally left unset

      // Act & Assert: Should throw
      expect(() => assertProductionFailClosedMode()).toThrow();

      // Act & Assert: Capture the error to verify message contents
      try {
        assertProductionFailClosedMode();
        // Should not reach here
        expect.fail("Expected assertProductionFailClosedMode to throw");
      } catch (error) {
        const message = (error as Error).message;
        
        // Verify the thrown message contains the actual var values
        expect(message).toContain("NODE_ENV=production");
        expect(message).toContain("CLARITYBURST_FAIL_OPEN=1");
        expect(message).toContain("CLARITYBURST_ROUTER_REQUIRED=(not set)");
        
        // Verify it mentions fail-open mode is unsafe in production
        expect(message).toContain("Cannot start in production with fail-open mode active");
        expect(message).toContain("unsafe in production");
      }
    });
  });

  describe("Case 2: NODE_ENV=production + CLARITYBURST_FAIL_OPEN=1 + CLARITYBURST_ROUTER_REQUIRED=1 → does NOT throw", () => {
    it("should NOT throw because router-required forces closed (precedence rule)", () => {
      // Arrange: Both flags set - this is the silent-regression case
      // ROUTER_REQUIRED=1 takes precedence and forces fail-closed, so boot is allowed
      process.env.NODE_ENV = "production";
      process.env.CLARITYBURST_FAIL_OPEN = "1";
      process.env.CLARITYBURST_ROUTER_REQUIRED = "1";

      // Act & Assert: Should NOT throw
      expect(() => assertProductionFailClosedMode()).not.toThrow();
    });
  });

  describe("Case 3: NODE_ENV not production + CLARITYBURST_FAIL_OPEN=1 → does NOT throw", () => {
    it("should NOT throw when NODE_ENV is unset (fail-open only a problem in production)", () => {
      // Arrange: NODE_ENV unset (not production)
      // NODE_ENV is already deleted in beforeEach
      process.env.CLARITYBURST_FAIL_OPEN = "1";

      // Act & Assert: Should NOT throw
      expect(() => assertProductionFailClosedMode()).not.toThrow();
    });

    it("should NOT throw when NODE_ENV=development (fail-open only a problem in production)", () => {
      // Arrange: NODE_ENV=development
      process.env.NODE_ENV = "development";
      process.env.CLARITYBURST_FAIL_OPEN = "1";

      // Act & Assert: Should NOT throw
      expect(() => assertProductionFailClosedMode()).not.toThrow();
    });

    it("should NOT throw when NODE_ENV=test (fail-open only a problem in production)", () => {
      // Arrange: NODE_ENV=test
      process.env.NODE_ENV = "test";
      process.env.CLARITYBURST_FAIL_OPEN = "1";

      // Act & Assert: Should NOT throw
      expect(() => assertProductionFailClosedMode()).not.toThrow();
    });
  });

  describe("Case 4: NODE_ENV=production + no fail-open flags → does NOT throw", () => {
    it("should NOT throw with normal safe production config (no fail-open flags)", () => {
      // Arrange: Normal production config - just NODE_ENV=production, no other flags
      process.env.NODE_ENV = "production";
      // CLARITYBURST_FAIL_OPEN and CLARITYBURST_ROUTER_REQUIRED both unset

      // Act & Assert: Should NOT throw
      expect(() => assertProductionFailClosedMode()).not.toThrow();
    });

    it("should NOT throw when NODE_ENV=production with CLARITYBURST_ROUTER_REQUIRED=1 only", () => {
      // Arrange: Production with only router-required set
      process.env.NODE_ENV = "production";
      process.env.CLARITYBURST_ROUTER_REQUIRED = "1";
      // CLARITYBURST_FAIL_OPEN unset

      // Act & Assert: Should NOT throw
      expect(() => assertProductionFailClosedMode()).not.toThrow();
    });
  });

  describe("Environment restoration verification", () => {
    it("should have clean environment at start of each test", () => {
      // Verify beforeEach cleaned up
      expect(process.env.NODE_ENV).toBeUndefined();
      expect(process.env.CLARITYBURST_FAIL_OPEN).toBeUndefined();
      expect(process.env.CLARITYBURST_ROUTER_REQUIRED).toBeUndefined();
    });
  });
});
