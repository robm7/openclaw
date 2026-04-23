/**
 * TRIPWIRE TEST: NETWORK_IO Router Outage Fail-Closed
 *
 * Verifies that network I/O operations fail closed when the router is unavailable,
 * following the same fail-closed mechanism as FILE_SYSTEM_OPS and MEMORY_MODIFY.
 *
 * This tripwire ensures that agent fetch/HTTP operations cannot proceed when
 * ClarityBurst routing is broken, preventing silent bypass of network gating.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NetworkContext } from "../decision-override.js";
import { applyNetworkOverrides } from "../decision-override.js";
import * as routerClient from "../router-client.js";

describe("NETWORK_IO Router Outage - Fail-Closed Tripwire", () => {
  beforeEach(() => {
    process.env.CLARITYBURST_ROUTER_URL = "http://localhost:3001";
    process.env.CLARITYBURST_ENABLED = "true";
    process.env.CLARITYBURST_ROUTER_REQUIRED = "1";
  });

  afterEach(() => {
    delete process.env.CLARITYBURST_ROUTER_URL;
    delete process.env.CLARITYBURST_ENABLED;
    delete process.env.CLARITYBURST_ROUTER_REQUIRED;
  });

  it("should return ABSTAIN_CLARIFY with router_outage when router unavailable", async () => {
    // Arrange: Create a context for a fetch operation
    const context: NetworkContext = {
      stageId: "NETWORK_IO",
      userConfirmed: false,
      operation: "fetch",
      url: "https://api.example.com/data",
    };

    // Mock routeClarityBurst to simulate router outage
    vi.spyOn(routerClient, "routeClarityBurst").mockRejectedValue(new Error("Router unavailable"));

    // Act: Call applyNetworkOverrides (async version)
    const result = await applyNetworkOverrides(context);

    // Assert: Should return ABSTAIN_CLARIFY with ROUTER_UNAVAILABLE reason
    expect(result).toEqual(
      expect.objectContaining({
        outcome: "ABSTAIN_CLARIFY",
        reason: "ROUTER_UNAVAILABLE",
        stageId: "NETWORK_IO",
        contractId: null,
      }),
    );

    // Verify the instructions are present
    if (result.outcome === "ABSTAIN_CLARIFY") {
      expect(result).toHaveProperty("instructions");
      expect(typeof result.instructions).toBe("string");
    }
  });

  it("should block fetch operations when router is unavailable (fail-closed invariant)", async () => {
    // Arrange: Network operation context
    const context: NetworkContext = {
      stageId: "NETWORK_IO",
      operation: "fetch",
      url: "https://sensitive-api.example.com/confidential",
    };

    // Mock routeClarityBurst to simulate router outage
    vi.spyOn(routerClient, "routeClarityBurst").mockRejectedValue(new Error("Connection refused"));

    // Act
    const result = await applyNetworkOverrides(context);

    // Assert: Must not proceed (fail-closed invariant)
    expect(result.outcome).not.toBe("PROCEED");
    expect(result.outcome).toBe("ABSTAIN_CLARIFY");
    if (result.outcome === "ABSTAIN_CLARIFY") {
      expect(result.reason).toBe("ROUTER_UNAVAILABLE");
    }
  });

  it("should provide recovery instructions when router outage occurs", async () => {
    // Arrange
    const context: NetworkContext = {
      stageId: "NETWORK_IO",
      operation: "fetch",
      url: "https://api.example.com",
    };

    // Mock routeClarityBurst to simulate router failure
    vi.spyOn(routerClient, "routeClarityBurst").mockRejectedValue(new Error("Service unavailable"));

    // Act
    const result = await applyNetworkOverrides(context);

    // Assert: Instructions should mention router restoration
    if (result.outcome === "ABSTAIN_CLARIFY" && result.instructions) {
      expect(result).toHaveProperty("instructions");
      const instructions = result.instructions;
      expect(instructions.toLowerCase()).toContain("router");
    }
  });
});
