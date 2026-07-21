/**
 * WIRING tests: NETWORK_IO ClarityBurstAbstainError — central non-retryable handling path.
 *
 * Moved out of clarityburst-plugin/src/decision-override.test.ts because this
 * block deliberately exercises the REAL convertAbstainToBlockedResponse from
 * pi-tool-definition-adapter.ts (fork WIRING code), which the plugin package
 * must not depend on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  convertAbstainToBlockedResponse,
  type BlockedResponsePayload,
} from "./pi-tool-definition-adapter.js";
import {
  applyNetworkOverrides,
  type OntologyPack,
  type RouteResult,
  type NetworkIOContext,
} from "../clarityburst/decision-override.js";
import { ClarityBurstAbstainError } from "../clarityburst/errors.js";

/**
 * Mock tool execution function - tracks call count
 */
function createMockToolExecutor() {
  let callCount = 0;
  return {
    execute: vi.fn((): { success: true; result: string } => {
      callCount++;
      return { success: true as const, result: "mock_result" };
    }),
    getCallCount: () => callCount,
    reset: () => {
      callCount = 0;
    },
  };
}

/**
 * Creates a mock NETWORK_IO ontology pack with a HIGH-risk contract
 * that requires confirmation (needs_confirmation: true)
 */
function createMockNetworkIOPack(): OntologyPack {
  return {
    pack_id: "openclawd.NETWORK_IO_TEST",
    pack_version: "1.0.0",
    stage_id: "NETWORK_IO",
    description: "Test pack for NETWORK_IO operations",
    thresholds: {
      min_confidence_T: 0.55,
      dominance_margin_Delta: 0.1,
    },
    contracts: [
      {
        contract_id: "NETWORK_GET_PUBLIC",
        risk_class: "LOW",
        required_fields: ["url", "method"],
        limits: {},
        needs_confirmation: false,
        deny_by_default: false,
        capability_requirements: [],
        canonicalPhrases: [],
        keywordWeights: {},
        synonymPhrases: {},
        scoring: { lambdas: { lambda_phrase: 0, lambda_keyword: 0, lambda_semantic: 0 } },
      },
      {
        contract_id: "NETWORK_HIGH_RISK_OPERATION",
        risk_class: "HIGH",
        required_fields: ["url", "method", "auth_header"],
        limits: {
          token_expiry_check: true,
        },
        needs_confirmation: true,
        deny_by_default: false,
        capability_requirements: [],
        canonicalPhrases: [],
        keywordWeights: {},
        synonymPhrases: {},
        scoring: { lambdas: { lambda_phrase: 0, lambda_keyword: 0, lambda_semantic: 0 } },
      },
      {
        contract_id: "NETWORK_CRITICAL_SOCKET",
        risk_class: "CRITICAL",
        required_fields: ["host", "port", "protocol"],
        limits: {
          allowed_ports: [],
          requires_audit: true,
        },
        needs_confirmation: true,
        deny_by_default: true,
        capability_requirements: [],
        canonicalPhrases: [],
        keywordWeights: {},
        synonymPhrases: {},
        scoring: { lambdas: { lambda_phrase: 0, lambda_keyword: 0, lambda_semantic: 0 } },
      },
    ],
    field_schema: {},
  };
}

/**
 * Creates a route result that routes to a specific contract
 * with scores that PASS uncertainty gating (high confidence, good dominance)
 */
function createPassingRouteResult(contractId: string): RouteResult {
  return {
    ok: true,
    data: {
      top1: {
        contract_id: contractId,
        score: 0.92, // Well above min_confidence_T of 0.55
      },
      top2: {
        contract_id: "NETWORK_GET_PUBLIC",
        score: 0.45, // Dominance margin: 0.92 - 0.45 = 0.47 > 0.10
      },
    },
  };
}

/**
 * Central adapter function that wraps applyNetworkOverrides and converts
 * abstain outcomes to BlockedResponsePayload through the non-retryable path.
 * This is the function that the network tool executor integrates with.
 *
 * NOTE: This uses the real convertAbstainToBlockedResponse from pi-tool-definition-adapter.ts
 * which is the production code path for SHELL_EXEC, FILE_SYSTEM_OPS, and NETWORK_IO.
 */
function executeNetworkOperationWithGating(
  pack: OntologyPack,
  routeResult: RouteResult,
  context: NetworkIOContext,
  toolExecutor: ReturnType<typeof createMockToolExecutor>,
): { success: true; result: unknown } | BlockedResponsePayload {
  const gatingResult = applyNetworkOverrides(pack, routeResult, context);

  if (gatingResult.outcome === "ABSTAIN_CLARIFY") {
    // Convert to blocked response - this is the non-retryable path
    // Extract nonRetryable from gatingResult (may not be in type but present in object)
    const nonRetryable =
      (gatingResult as unknown as { nonRetryable?: boolean }).nonRetryable ??
      gatingResult.reason === "router_outage";
    const error = new ClarityBurstAbstainError({
      stageId: "NETWORK_IO",
      outcome: gatingResult.outcome,
      reason: gatingResult.reason,
      contractId: gatingResult.contractId,
      instructions: gatingResult.instructions ?? `${gatingResult.outcome}: ${gatingResult.reason}`,
      nonRetryable,
    });
    return convertAbstainToBlockedResponse(error, gatingResult.instructions);
  }

  if (gatingResult.outcome === "ABSTAIN_CONFIRM") {
    // Convert to blocked response - ABSTAIN_CONFIRM is retryable (user can confirm)
    const error = new ClarityBurstAbstainError({
      stageId: "NETWORK_IO",
      outcome: gatingResult.outcome,
      reason: gatingResult.reason,
      contractId: gatingResult.contractId,
      instructions: gatingResult.instructions ?? `${gatingResult.outcome}: ${gatingResult.reason}`,
      nonRetryable: false, // ABSTAIN_CONFIRM is retryable
    });
    return convertAbstainToBlockedResponse(error, gatingResult.instructions);
  }

  // Only execute tool when gating passes with PROCEED
  return toolExecutor.execute();
}

describe("NETWORK_IO ClarityBurstAbstainError - central non-retryable handling path", () => {
  let mockPack: OntologyPack;
  let mockToolExecutor: ReturnType<typeof createMockToolExecutor>;

  beforeEach(() => {
    mockPack = createMockNetworkIOPack();
    mockToolExecutor = createMockToolExecutor();
  });

  describe("router_outage → ABSTAIN_CLARIFY propagation", () => {
    it("should return blocked response with all fields intact when router is unavailable", () => {
      // Arrange: Router outage scenario - routeResult.ok is false
      const routeResult: RouteResult = {
        ok: false,
        // No data available due to outage
      };
      const context: NetworkIOContext = {
        stageId: "NETWORK_IO",
        userConfirmed: true, // Even with confirmation, router outage blocks
        operation: "fetch",
        url: "https://api.example.com/data",
      };

      // Act: Execute through central non-retryable handling path
      const result = executeNetworkOperationWithGating(
        mockPack,
        routeResult,
        context,
        mockToolExecutor,
      );

      // Assert: Blocked response payload structure
      expect(result).toMatchObject({
        nonRetryable: true,
        stageId: "NETWORK_IO",
        outcome: "ABSTAIN_CLARIFY",
        reason: "router_outage",
        contractId: null,
      });

      // Assert: Instructions field is present and meaningful
      expect((result as BlockedResponsePayload).instructions).toBeDefined();
      expect((result as BlockedResponsePayload).instructions).toContain("router");

      // Assert: Tool executor was NOT called
      expect(mockToolExecutor.getCallCount()).toBe(0);
      expect(mockToolExecutor.execute).not.toHaveBeenCalled();
    });

    it("should propagate router_outage through ClarityBurstAbstainError with exact fields", () => {
      // Arrange: Direct test of applyNetworkOverrides for router_outage
      const routeResult: RouteResult = { ok: false };
      const context: NetworkIOContext = {
        stageId: "NETWORK_IO",
        userConfirmed: false,
      };

      // Act
      const gatingResult = applyNetworkOverrides(mockPack, routeResult, context);

      // Assert: All expected fields present
      expect(gatingResult.outcome).toBe("ABSTAIN_CLARIFY");
      expect(gatingResult).toEqual({
        outcome: "ABSTAIN_CLARIFY",
        reason: "router_outage",
        stageId: "NETWORK_IO",
        contractId: null,
        nonRetryable: true,
        instructions: expect.stringContaining("router"),
      });

      // Verify this is converted to non-retryable blocked response
      if (gatingResult.outcome === "ABSTAIN_CLARIFY") {
        // Extract nonRetryable from gatingResult (added via type assertion)
        const nonRetryable =
          (gatingResult as unknown as { nonRetryable?: boolean }).nonRetryable ?? false;
        const error = new ClarityBurstAbstainError({
          stageId: "NETWORK_IO",
          outcome: gatingResult.outcome,
          reason: gatingResult.reason,
          contractId: gatingResult.contractId,
          instructions:
            gatingResult.instructions ?? `${gatingResult.outcome}: ${gatingResult.reason}`,
          nonRetryable,
        });
        const blocked = convertAbstainToBlockedResponse(error, gatingResult.instructions);

        expect(blocked.nonRetryable).toBe(true);
        expect(blocked.stageId).toBe("NETWORK_IO");
        expect(blocked.outcome).toBe("ABSTAIN_CLARIFY");
        expect(blocked.reason).toBe("router_outage");
        expect(blocked.contractId).toBeNull();
        expect(blocked.instructions).toBeDefined();
      }
    });
  });

  describe("ABSTAIN_CONFIRM - confirmation required & missing", () => {
    it("should return blocked response with all fields intact when confirmation is missing", () => {
      // Arrange: HIGH-risk contract with passing scores but no confirmation
      const routeResult = createPassingRouteResult("NETWORK_HIGH_RISK_OPERATION");
      const context: NetworkIOContext = {
        stageId: "NETWORK_IO",
        userConfirmed: false, // Confirmation missing
        operation: "fetch",
        url: "https://api.example.com/sensitive",
      };

      // Act: Execute through central non-retryable handling path
      const result = executeNetworkOperationWithGating(
        mockPack,
        routeResult,
        context,
        mockToolExecutor,
      );

      // Assert: Blocked response payload structure
      expect(result).toMatchObject({
        nonRetryable: false, // ABSTAIN_CONFIRM is retryable (user can confirm)
        stageId: "NETWORK_IO",
        outcome: "ABSTAIN_CONFIRM",
        reason: "CONFIRM_REQUIRED",
        contractId: "NETWORK_HIGH_RISK_OPERATION",
      });

      // Assert: Instructions field is present with confirmation guidance
      expect((result as BlockedResponsePayload).instructions).toBeDefined();
      expect((result as BlockedResponsePayload).instructions).toContain("userConfirmed=true");

      // Assert: Tool executor was NOT called
      expect(mockToolExecutor.getCallCount()).toBe(0);
      expect(mockToolExecutor.execute).not.toHaveBeenCalled();
    });

    it("should propagate ABSTAIN_CONFIRM through ClarityBurstAbstainError with exact fields", () => {
      // Arrange: CRITICAL-risk contract without confirmation
      const routeResult = createPassingRouteResult("NETWORK_CRITICAL_SOCKET");
      const context: NetworkIOContext = {
        stageId: "NETWORK_IO",
        userConfirmed: undefined, // Explicitly undefined
        operation: "connect",
        url: "tcp://192.168.1.1:8080",
      };

      // Act
      const gatingResult = applyNetworkOverrides(mockPack, routeResult, context);

      // Assert: All expected fields present
      expect(gatingResult.outcome).toBe("ABSTAIN_CONFIRM");
      expect(gatingResult).toEqual({
        outcome: "ABSTAIN_CONFIRM",
        reason: "CONFIRM_REQUIRED",
        contractId: "NETWORK_CRITICAL_SOCKET",
        instructions: expect.stringContaining("CONFIRM NETWORK_IO"),
      });

      // Verify this is converted to non-retryable blocked response
      if (gatingResult.outcome === "ABSTAIN_CONFIRM") {
        const error = new ClarityBurstAbstainError({
          stageId: "NETWORK_IO",
          outcome: gatingResult.outcome,
          reason: gatingResult.reason,
          contractId: gatingResult.contractId,
          instructions:
            gatingResult.instructions ?? `${gatingResult.outcome}: ${gatingResult.reason}`,
        });
        const blocked = convertAbstainToBlockedResponse(error, gatingResult.instructions);

        expect(blocked.nonRetryable).toBe(false);
        expect(blocked.stageId).toBe("NETWORK_IO");
        expect(blocked.outcome).toBe("ABSTAIN_CONFIRM");
        expect(blocked.reason).toBe("CONFIRM_REQUIRED");
        expect(blocked.contractId).toBe("NETWORK_CRITICAL_SOCKET");
        expect(blocked.instructions).toContain("CONFIRM NETWORK_IO");
      }
    });

    it("should NOT execute tool and NOT retry when ABSTAIN_CONFIRM is returned", () => {
      // Arrange: Multiple attempts should all fail without tool execution
      const routeResult = createPassingRouteResult("NETWORK_HIGH_RISK_OPERATION");
      const context: NetworkIOContext = {
        stageId: "NETWORK_IO",
        userConfirmed: false,
      };

      // Act: Simulate 3 retry attempts (should all be blocked)
      const results: ReturnType<typeof executeNetworkOperationWithGating>[] = [];
      for (let i = 0; i < 3; i++) {
        results.push(
          executeNetworkOperationWithGating(mockPack, routeResult, context, mockToolExecutor),
        );
      }

      // Assert: All results are blocked responses
      for (const result of results) {
        expect((result as BlockedResponsePayload).nonRetryable).toBe(false); // ABSTAIN_CONFIRM is retryable
        expect((result as BlockedResponsePayload).outcome).toBe("ABSTAIN_CONFIRM");
      }

      // Assert: Tool was NEVER called across all attempts
      expect(mockToolExecutor.getCallCount()).toBe(0);
      expect(mockToolExecutor.execute).not.toHaveBeenCalled();
    });
  });

  describe("comparison: PROCEED outcome allows tool execution", () => {
    it("should execute tool exactly once when PROCEED is returned", () => {
      // Arrange: LOW-risk contract that doesn't need confirmation
      const routeResult = createPassingRouteResult("NETWORK_GET_PUBLIC");
      const context: NetworkIOContext = {
        stageId: "NETWORK_IO",
        userConfirmed: false, // LOW risk - doesn't matter
        operation: "fetch",
        url: "https://public-api.example.com/data",
      };

      // Act
      const result = executeNetworkOperationWithGating(
        mockPack,
        routeResult,
        context,
        mockToolExecutor,
      );

      // Assert: Successful execution result
      expect(result).toEqual({ success: true, result: "mock_result" });

      // Assert: Tool was called exactly once
      expect(mockToolExecutor.getCallCount()).toBe(1);
      expect(mockToolExecutor.execute).toHaveBeenCalledTimes(1);
    });

    it("should execute tool when userConfirmed=true for HIGH-risk contract", () => {
      // Arrange: HIGH-risk with confirmation provided
      const routeResult = createPassingRouteResult("NETWORK_HIGH_RISK_OPERATION");
      const context: NetworkIOContext = {
        stageId: "NETWORK_IO",
        userConfirmed: true, // Confirmation provided
        operation: "fetch",
        url: "https://api.example.com/sensitive",
      };

      // Act
      const result = executeNetworkOperationWithGating(
        mockPack,
        routeResult,
        context,
        mockToolExecutor,
      );

      // Assert: Successful execution
      expect(result).toEqual({ success: true, result: "mock_result" });
      expect(mockToolExecutor.getCallCount()).toBe(1);
    });
  });
});
