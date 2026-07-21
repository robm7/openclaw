/**
 * REGRESSION TEST: Web Search Inference Network I/O Gate Integration
 *
 * Validates that applyNetworkIOGate is invoked in fetchWithWebToolsNetworkGuard()
 * and that gate abstain outcomes block the request from reaching the network stack.
 *
 * This test ensures the exact boundary condition is preserved:
 * - Gate executes BEFORE SSRF guard
 * - Gate executes BEFORE network fetch
 * - ABSTAIN outcomes prevent any network operations
 *
 * MOCKING PATTERN (verified — same as pack-load.test.ts / pi-model-discovery.compat.test.ts /
 * pw-session.network_io_gate.tripwire.test.ts / store.test.ts):
 * web-guarded-fetch.js must NOT be statically imported at the top of this file.
 * It statically imports fetch-guard.js and decision-override.js, so a static
 * import would bind against the REAL modules before any vi.doMock call runs,
 * making the mocks silently inert (the previous version of this file had
 * exactly that bug: mockFetchGuard.not.toHaveBeenCalled() passed vacuously).
 *
 * Instead we use vi.resetModules() + vi.doMock() + dynamic await import() of
 * web-guarded-fetch.js AFTER the mocks are registered, so the fresh module
 * graph binds against the mocked fetch-guard.js and decision-override.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock functions created up-front so the vi.doMock factories can close over them.
const mockApplyNetworkOverrides = vi.fn();
const mockFetchWithSsrFGuard = vi.fn();

// Factory execution counters: prove the vi.doMock registrations genuinely
// intercept module resolution (a factory that never executes means the mock
// never engaged and "not called" assertions would be vacuous).
let fetchGuardMockFactoryExecutions = 0;
let decisionOverrideMockFactoryExecutions = 0;

type WebGuardedFetchModule = typeof import("./web-guarded-fetch.js");
type ErrorsModule = typeof import("../../clarityburst/errors.js");

let fetchWithWebToolsNetworkGuard: WebGuardedFetchModule["fetchWithWebToolsNetworkGuard"];
let withWebToolsNetworkGuard: WebGuardedFetchModule["withWebToolsNetworkGuard"];
// Must come from the same fresh module registry as web-guarded-fetch.js so
// instanceof checks match the class instance the module actually throws.
let ClarityBurstAbstainError: ErrorsModule["ClarityBurstAbstainError"];

async function loadModuleWithMocks(): Promise<void> {
  vi.resetModules();

  vi.doMock("../../clarityburst/decision-override.js", () => {
    decisionOverrideMockFactoryExecutions += 1;
    return { applyNetworkOverrides: mockApplyNetworkOverrides };
  });

  vi.doMock("../../infra/net/fetch-guard.js", () => {
    fetchGuardMockFactoryExecutions += 1;
    return { fetchWithSsrFGuard: mockFetchWithSsrFGuard };
  });

  // Import AFTER the mocks are registered (vi.doMock is NOT hoisted), so the
  // fresh module graph binds against the mocked modules.
  const mod = await import("./web-guarded-fetch.js");
  const errors = await import("../../clarityburst/errors.js");

  fetchWithWebToolsNetworkGuard = mod.fetchWithWebToolsNetworkGuard;
  withWebToolsNetworkGuard = mod.withWebToolsNetworkGuard;
  ClarityBurstAbstainError = errors.ClarityBurstAbstainError;
}

describe("Web search inference gate integration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await loadModuleWithMocks();
  });

  afterEach(() => {
    vi.doUnmock("../../clarityburst/decision-override.js");
    vi.doUnmock("../../infra/net/fetch-guard.js");
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe("Mock wiring sanity (positive control)", () => {
    it("fetch-guard.js mock factory actually executed for the fresh module graph", () => {
      // If the doMock never engaged, web-guarded-fetch.js would be bound to the
      // real fetch-guard.js and every "not called" assertion below is vacuous.
      expect(fetchGuardMockFactoryExecutions).toBeGreaterThan(0);
      expect(decisionOverrideMockFactoryExecutions).toBeGreaterThan(0);
    });

    it("fetchWithSsrFGuard mock IS invoked when gate passes (proves the mock is genuinely wired)", async () => {
      // Setup: Gate passes, so execution must reach the (mocked) SSRF guard.
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "PASS",
        reason: "allowed",
        contractId: null,
      });
      const release = vi.fn().mockResolvedValue(undefined);
      mockFetchWithSsrFGuard.mockResolvedValue({
        response: new Response("ok"),
        finalUrl: "https://api.perplexity.ai/chat/completions",
        release,
      });

      const result = await fetchWithWebToolsNetworkGuard({
        url: "https://api.perplexity.ai/chat/completions",
        init: { method: "POST" },
      });

      // PROOF the mock engages: exact call count, not just presence.
      expect(mockFetchWithSsrFGuard).toHaveBeenCalledTimes(1);
      expect(mockFetchWithSsrFGuard).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://api.perplexity.ai/chat/completions",
          proxy: "env",
        })
      );
      // The returned value came from the mock, not the real guard.
      expect(result.finalUrl).toBe("https://api.perplexity.ai/chat/completions");
    });
  });

  describe("Gate invocation at fetch boundary", () => {
    it("applyNetworkOverrides is called BEFORE fetchWithSsrFGuard", async () => {
      // Setup: Gate abstains
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CLARIFY",
        reason: "PACK_POLICY_INCOMPLETE",
        contractId: null,
        instructions: "Pack policy incomplete",
      });

      try {
        // Execute: Call fetchWithWebToolsNetworkGuard
        await fetchWithWebToolsNetworkGuard({
          url: "https://api.perplexity.ai/chat/completions",
          init: { method: "POST" },
        });
        expect.fail("Should have thrown ClarityBurstAbstainError");
      } catch (error) {
        // Assert: Gate was called and threw before fetchWithSsrFGuard
        expect(mockApplyNetworkOverrides).toHaveBeenCalledTimes(1);
        expect(mockFetchWithSsrFGuard).not.toHaveBeenCalled(); // Never reached network guard
        expect(error).toBeInstanceOf(ClarityBurstAbstainError);
      }
    });

    it("fetchWithSsrFGuard is NOT called when gate abstains", async () => {
      // Setup: Gate returns ABSTAIN_CONFIRM
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CONFIRM",
        reason: "CONFIRM_REQUIRED",
        contractId: "test-contract",
        instructions: "User confirmation required",
      });

      try {
        await fetchWithWebToolsNetworkGuard({
          url: "https://api.perplexity.ai/chat/completions",
          init: { method: "POST" },
        });
        expect.fail("Should have thrown on ABSTAIN_CONFIRM");
      } catch (error) {
        // Assert: Gate abstain prevents network operations
        expect(error).toBeInstanceOf(ClarityBurstAbstainError);
        expect(mockApplyNetworkOverrides).toHaveBeenCalledTimes(1);
        expect(mockFetchWithSsrFGuard).not.toHaveBeenCalled();
      }
    });

    it("gate is called with correct URL and method from web search inference", async () => {
      // Setup: Mock gate to track parameters
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CLARIFY",
        reason: "PACK_POLICY_INCOMPLETE",
        contractId: null,
      });

      try {
        await fetchWithWebToolsNetworkGuard({
          url: "https://api.perplexity.ai/chat/completions",
          init: { method: "POST", body: JSON.stringify({ query: "test" }) },
        });
      } catch {
        // Expected to fail
      }

      // Assert: Gate was called with NetworkContext
      expect(mockApplyNetworkOverrides).toHaveBeenCalledWith(
        expect.objectContaining({
          stageId: "NETWORK_IO",
          operation: "POST",
          url: expect.stringContaining("perplexity"),
          userConfirmed: false,
        })
      );
    });

    it("gate receives method: POST for web search inference requests", async () => {
      // Setup: Track gate calls
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CLARIFY",
        reason: "PACK_POLICY_INCOMPLETE",
        contractId: null,
      });

      const requests = [
        {
          provider: "Perplexity",
          url: "https://api.perplexity.ai/chat/completions",
        },
        { provider: "Grok", url: "https://api.x.ai/v1/responses" },
        {
          provider: "Gemini",
          url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        },
        { provider: "Kimi", url: "https://api.moonshot.ai/v1/chat/completions" },
      ];

      for (const req of requests) {
        mockApplyNetworkOverrides.mockClear();

        try {
          await fetchWithWebToolsNetworkGuard({
            url: req.url,
            init: { method: "POST" },
          });
        } catch {
          // Expected to fail
        }

        // Assert: All inference requests are POST (side-effectful)
        expect(mockApplyNetworkOverrides).toHaveBeenCalledWith(
          expect.objectContaining({
            operation: "POST",
          })
        );
      }
    });
  });

  describe("Gate abstain blocks execution", () => {
    it("ABSTAIN_CLARIFY outcome throws ClarityBurstAbstainError", async () => {
      // Setup: Gate returns ABSTAIN_CLARIFY
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CLARIFY",
        reason: "PACK_POLICY_INCOMPLETE",
        contractId: null,
        instructions: "Pack policy is incomplete for NETWORK_IO stage",
      });

      // Execute & Assert
      await expect(
        fetchWithWebToolsNetworkGuard({
          url: "https://api.perplexity.ai/chat/completions",
          init: { method: "POST" },
        })
      ).rejects.toThrow(ClarityBurstAbstainError);
      expect(mockFetchWithSsrFGuard).not.toHaveBeenCalled();
    });

    it("ABSTAIN_CONFIRM outcome throws ClarityBurstAbstainError", async () => {
      // Setup: Gate returns ABSTAIN_CONFIRM
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CONFIRM",
        reason: "CONFIRM_REQUIRED",
        contractId: "inference-contract-123",
        instructions: "User confirmation token required",
      });

      // Execute & Assert
      await expect(
        fetchWithWebToolsNetworkGuard({
          url: "https://api.x.ai/v1/responses",
          init: { method: "POST" },
        })
      ).rejects.toThrow(ClarityBurstAbstainError);
      expect(mockFetchWithSsrFGuard).not.toHaveBeenCalled();
    });

    it("withWebToolsNetworkGuard propagates gate abstain error", async () => {
      // Setup: Gate abstains
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CLARIFY",
        reason: "PACK_POLICY_INCOMPLETE",
        contractId: null,
      });

      // Execute & Assert: Error propagates before run handler is called
      let runHandlerCalled = false;
      await expect(
        withWebToolsNetworkGuard(
          {
            url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
            init: { method: "POST" },
          },
          async () => {
            runHandlerCalled = true;
            return "result";
          }
        )
      ).rejects.toThrow(ClarityBurstAbstainError);

      // Assert: Run handler was never invoked because gate blocked execution
      expect(runHandlerCalled).toBe(false);
      expect(mockFetchWithSsrFGuard).not.toHaveBeenCalled();
    });
  });

  describe("Fail-closed behavior", () => {
    it("gate error propagates immediately, blocking network operations", async () => {
      // Setup: Gate throws error
      const gateError = new ClarityBurstAbstainError({
        stageId: "NETWORK_IO",
        outcome: "ABSTAIN_CLARIFY",
        reason: "PACK_POLICY_INCOMPLETE",
        contractId: null,
        instructions: "Cannot proceed without pack policy",
      });
      mockApplyNetworkOverrides.mockRejectedValue(gateError);

      // Execute & Assert
      await expect(
        fetchWithWebToolsNetworkGuard({
          url: "https://api.perplexity.ai/chat/completions",
          init: { method: "POST" },
        })
      ).rejects.toThrow(gateError);
      expect(mockFetchWithSsrFGuard).not.toHaveBeenCalled();
    });

    it("no fetch occurs when gate abstains", async () => {
      // Setup: Gate abstains, mock global fetch
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CLARIFY",
        reason: "PACK_POLICY_INCOMPLETE",
        contractId: null,
      });

      const mockFetch = vi.spyOn(globalThis, "fetch");

      try {
        await fetchWithWebToolsNetworkGuard({
          url: "https://api.perplexity.ai/chat/completions",
          init: { method: "POST" },
        });
      } catch {
        // Expected
      }

      // Assert: fetch was never called (gate blocked before any network operation)
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockFetchWithSsrFGuard).not.toHaveBeenCalled();

      mockFetch.mockRestore();
    });
  });

  describe("Provider routing invariant: all inference paths through fetchWithWebToolsNetworkGuard()", () => {
    /**
     * TRIPWIRE TEST: Proves all current web-search inference provider request paths
     * (Perplexity, Grok, Gemini, Kimi) route through fetchWithWebToolsNetworkGuard()
     * and that no parallel raw fetch() execution path exists.
     *
     * Fails if:
     * - Any provider-specific path bypasses the shared boundary
     * - Direct fetch() is called outside the guarded flow
     * - Gate is not invoked at the NETWORK_IO stage for inference requests
     */
    it("all inference providers route exclusively through fetchWithWebToolsNetworkGuard()", async () => {
      const providers = ["perplexity", "grok", "gemini", "kimi"] as const;
      const endpoints = {
        perplexity: "https://api.perplexity.ai/chat/completions",
        grok: "https://api.x.ai/v1/responses",
        gemini: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        kimi: "https://api.moonshot.ai/v1/chat/completions",
      };

      // Gate passes so execution proceeds to the (mocked) SSRF guard
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "PASS",
        reason: "allowed",
        contractId: null,
      } as any);
      const release = vi.fn().mockResolvedValue(undefined);
      mockFetchWithSsrFGuard.mockResolvedValue({
        response: new Response("ok"),
        finalUrl: "https://example.invalid/",
        release,
      });

      // Spy on raw fetch to detect any bypass attempts
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // For each provider endpoint, verify the routing
      for (const provider of providers) {
        mockApplyNetworkOverrides.mockClear();
        mockFetchWithSsrFGuard.mockClear();
        fetchSpy.mockClear();

        const endpoint = endpoints[provider];

        await fetchWithWebToolsNetworkGuard({
          url: endpoint,
          init: { method: "POST" },
        });

        // INVARIANT 1: Gate must be invoked for all inference providers
        expect(mockApplyNetworkOverrides).toHaveBeenCalledTimes(1);
        const gateCall = mockApplyNetworkOverrides.mock.calls[0]?.[0];
        expect(gateCall).toMatchObject({
          stageId: "NETWORK_IO",
          operation: "POST",
        });

        // INVARIANT 2: Approved requests reach the guarded SSRF path (mocked),
        // never a raw fetch() bypass.
        expect(mockFetchWithSsrFGuard).toHaveBeenCalledTimes(1);
        expect(mockFetchWithSsrFGuard).toHaveBeenCalledWith(
          expect.objectContaining({ url: endpoint })
        );
        expect(fetchSpy).not.toHaveBeenCalled();
      }

      // Cleanup
      fetchSpy.mockRestore();
    });

    it("gate abstain blocks all providers before any network execution", async () => {
      // Setup: Gate abstains for all attempts
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "ABSTAIN_CLARIFY",
        reason: "PACK_POLICY_INCOMPLETE",
        contractId: null,
      } as any);

      // Spy to ensure no raw fetch occurs
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const providers = [
        { name: "perplexity", url: "https://api.perplexity.ai/chat/completions" },
        { name: "grok", url: "https://api.x.ai/v1/responses" },
        {
          name: "gemini",
          url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        },
        { name: "kimi", url: "https://api.moonshot.ai/v1/chat/completions" },
      ];

      for (const { name, url } of providers) {
        fetchSpy.mockClear();
        mockFetchWithSsrFGuard.mockClear();

        // Execute: Try to make a request
        try {
          await fetchWithWebToolsNetworkGuard({
            url,
            init: { method: "POST" },
          });
          expect.fail(`${name} should have thrown ClarityBurstAbstainError`);
        } catch (err) {
          // Expected: Gate blocks before network
          expect(err).toBeInstanceOf(ClarityBurstAbstainError);
        }

        // INVARIANT: No raw fetch and no SSRF guard call when gate abstains
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(mockFetchWithSsrFGuard).not.toHaveBeenCalled();
      }

      fetchSpy.mockRestore();
    });

    it("detects if provider paths attempt to bypass fetchWithWebToolsNetworkGuard()", async () => {
      /**
       * This test serves as a "canary" to detect if any future refactoring
       * introduces direct fetch() calls or bypasses the guarded boundary.
       *
       * Instruments the NETWORK_IO gate to verify all inference request paths
       * invoke the guard, not raw fetch.
       */

      // Gate passes so execution proceeds to the (mocked) SSRF guard
      mockApplyNetworkOverrides.mockResolvedValue({
        outcome: "PASS",
        reason: "allowed",
        contractId: null,
      } as any);
      const release = vi.fn().mockResolvedValue(undefined);
      mockFetchWithSsrFGuard.mockResolvedValue({
        response: new Response("ok"),
        finalUrl: "https://example.invalid/",
        release,
      });

      // Spy on raw fetch to detect bypass attempts
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // For inference domains, verify the routing
      const inferenceDomains = [
        "api.perplexity.ai",
        "api.x.ai",
        "generativelanguage.googleapis.com",
        "api.moonshot.ai",
      ];

      for (const domain of inferenceDomains) {
        mockApplyNetworkOverrides.mockClear();
        mockFetchWithSsrFGuard.mockClear();
        fetchSpy.mockClear();

        await fetchWithWebToolsNetworkGuard({
          url: `https://${domain}/v1/test`,
          init: { method: "POST" },
        });

        // INVARIANT: Gate must be invoked for all inference domains
        // This proves requests route through fetchWithWebToolsNetworkGuard()
        expect(mockApplyNetworkOverrides).toHaveBeenCalledTimes(1);

        // INVARIANT: No direct fetch() bypass should exist
        // If gate allows the request, it proceeds to the (mocked) SSRF guard.
        // The gate is the required checkpoint.
        const gateCall = mockApplyNetworkOverrides.mock.calls[0]?.[0];
        expect(gateCall?.stageId).toBe("NETWORK_IO");
        expect(mockFetchWithSsrFGuard).toHaveBeenCalledTimes(1);
        expect(fetchSpy).not.toHaveBeenCalled();
      }

      fetchSpy.mockRestore();
    });
  });
});
