import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyNetworkIOGateAndFetch } from "../network-io-gating.js";
import { ClarityBurstAbstainError } from "../errors.js";


// Mock the router client so we can drive the NETWORK_IO gate to a PROCEED decision.
// NOTE: routeClarityBurst does Phase-A LOCAL scoring when a pack is present (it does
// NOT go through globalThis.fetch), so the existing fetchSpy cannot influence routing.
// By default we call through to the real implementation (preserving the ABSTAIN
// behavior of the first three tests); the fourth test overrides it once to force a
// high-confidence NETWORK_GET_PUBLIC PROCEED.
vi.mock("../../../clarityburst-plugin/src/router-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../clarityburst-plugin/src/router-client.js")>();
  return {
    ...actual,
    routeClarityBurst: vi.fn(actual.routeClarityBurst),
  };
});

import * as routerClient from "../../../clarityburst-plugin/src/router-client.js";


describe("manual NETWORK_IO gate probe", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let originalRouterUrl: string | undefined;

  beforeEach(() => {
    // config.ts requires CLARITYBURST_ROUTER_URL when ClarityBurst is enabled.
    // All other config env vars (CLARITYBURST_ENABLED, CLARITYBURST_ROUTER_TIMEOUT_MS,
    // CLARITYBURST_LOG_LEVEL, CLARITYBURST_API_KEY) have safe defaults and are optional.
    originalRouterUrl = process.env.CLARITYBURST_ROUTER_URL;
    process.env.CLARITYBURST_ROUTER_URL = "https://clarityburst-router.fly.dev";

    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok")
    );
  });

  afterEach(() => {
    if (originalRouterUrl === undefined) {
      delete process.env.CLARITYBURST_ROUTER_URL;
    } else {
      process.env.CLARITYBURST_ROUTER_URL = originalRouterUrl;
    }

    fetchSpy.mockRestore();
  });

  it("probes javascript: scheme", async () => {
    let threw = false;
    try {
      await applyNetworkIOGateAndFetch("javascript:alert(1)");
    } catch (e) {
      threw = true;
      console.log("THREW:", (e as Error).message);
    }
    console.log("fetch called:", fetchSpy.mock.calls.length > 0);
    console.log("fetch called with:", fetchSpy.mock.calls[0]?.[0]);
    console.log("threw:", threw);
  });

  it("probes userinfo in URL", async () => {
    let threw = false;
    try {
      await applyNetworkIOGateAndFetch("https://user:pass@example.com/");
    } catch (e) {
      threw = true;
      console.log("THREW:", (e as Error).message);
    }
    console.log("fetch called:", fetchSpy.mock.calls.length > 0);
    console.log("fetch called with:", fetchSpy.mock.calls[0]?.[0]);
    console.log("threw:", threw);
  });

  it("probes userinfo with legitimate-looking recognized hostname", async () => {
    // api.ollama.com is a real, legitimate-looking host that the NETWORK_IO pack
    // would normally recognize/approve for a typical GET (NETWORK_GET_PUBLIC, LOW risk,
    // needs_confirmation=false). Here we prepend user:pass@ credentials and observe
    // whether the gate still ABSTAINS or now PROCEEDS (reaching fetch) despite the
    // embedded credentials.
    let threw = false;
    try {
      await applyNetworkIOGateAndFetch("https://user:pass@api.ollama.com/");
    } catch (e) {
      threw = true;
      console.log("THREW:", (e as Error).message);
    }
    console.log("fetch called:", fetchSpy.mock.calls.length > 0);
    console.log("fetch called with:", fetchSpy.mock.calls[0]?.[0]);
    console.log("threw:", threw);
    console.log("outcome:", threw ? "ABSTAIN" : "PROCEED");
  });

  it("PROCEED path: forces router to approve, checks URL passed to outbound fetch", async () => {
    // Force the router to return a high-confidence PROCEED on NETWORK_GET_PUBLIC
    // (LOW risk, needs_confirmation=false). This lets the gate reach the point where
    // it performs the actual outbound fetch(url, init). We then inspect exactly what
    // URL string reaches fetch() — does the userinfo (user:pass@) survive?
    const routeSpy = vi
      .spyOn(routerClient, "routeClarityBurst")
      .mockResolvedValue({
        ok: true,
        data: {
          top1: { contract_id: "NETWORK_GET_PUBLIC", score: 0.95 },
          top2: { contract_id: "NETWORK_HEAD_REQUEST", score: 0.05 },
          router_version: "test-mock",
        },
      } as any);

    let threw = false;
    try {
      await applyNetworkIOGateAndFetch("https://user:pass@api.ollama.com/");
    } catch (e) {
      threw = true;
      console.log("THREW:", (e as Error).message);
    }

    console.log("router mock called:", routeSpy.mock.calls.length);
    console.log("fetch called:", fetchSpy.mock.calls.length > 0);
    console.log("fetch call count:", fetchSpy.mock.calls.length);
    console.log("fetch called with (URL passed to outbound fetch):", fetchSpy.mock.calls[0]?.[0]);
    console.log("threw:", threw);
    console.log("outcome:", threw ? "ABSTAIN" : "PROCEED");

    routeSpy.mockRestore();
  });

  it("PRE-FETCH GUARD: javascript: URL that would otherwise PROCEED is rejected before fetch", async () => {
    // Force the router to approve (same pattern as the PROCEED-path test). Without
    // the pre-fetch validation guard, this would reach fetch() with a javascript: URL.
    const routeSpy = vi
      .spyOn(routerClient, "routeClarityBurst")
      .mockResolvedValue({
        ok: true,
        data: {
          top1: { contract_id: "NETWORK_GET_PUBLIC", score: 0.95 },
          top2: { contract_id: "NETWORK_HEAD_REQUEST", score: 0.05 },
          router_version: "test-mock",
        },
      } as any);

    let threw = false;
    let caught: unknown;
    try {
      await applyNetworkIOGateAndFetch("javascript:alert(1)");
    } catch (e) {
      threw = true;
      caught = e;
      console.log("THREW:", (e as Error).message);
    }

    console.log("router mock called:", routeSpy.mock.calls.length);
    console.log("fetch called:", fetchSpy.mock.calls.length > 0);
    console.log("fetch call count:", fetchSpy.mock.calls.length);
    console.log("threw:", threw);
    console.log("is ClarityBurstAbstainError:", caught instanceof ClarityBurstAbstainError);

    // The request must be rejected before any fetch is performed.
    expect(threw).toBe(true);
    expect(caught).toBeInstanceOf(ClarityBurstAbstainError);
    expect(fetchSpy).not.toHaveBeenCalled();

    routeSpy.mockRestore();
  });

  it("PRE-FETCH GUARD: userinfo URL that would otherwise PROCEED is rejected before fetch", async () => {
    // Force the router to approve. Without the pre-fetch validation guard, this
    // would reach fetch() with credentials embedded in the URL (as demonstrated by
    // the PROCEED-path test above).
    const routeSpy = vi
      .spyOn(routerClient, "routeClarityBurst")
      .mockResolvedValue({
        ok: true,
        data: {
          top1: { contract_id: "NETWORK_GET_PUBLIC", score: 0.95 },
          top2: { contract_id: "NETWORK_HEAD_REQUEST", score: 0.05 },
          router_version: "test-mock",
        },
      } as any);

    let threw = false;
    let caught: unknown;
    try {
      await applyNetworkIOGateAndFetch("https://user:pass@api.ollama.com/");
    } catch (e) {
      threw = true;
      caught = e;
      console.log("THREW:", (e as Error).message);
    }

    console.log("router mock called:", routeSpy.mock.calls.length);
    console.log("fetch called:", fetchSpy.mock.calls.length > 0);
    console.log("fetch call count:", fetchSpy.mock.calls.length);
    console.log("threw:", threw);
    console.log("is ClarityBurstAbstainError:", caught instanceof ClarityBurstAbstainError);

    // The credentialed request must be rejected before any fetch is performed.
    expect(threw).toBe(true);
    expect(caught).toBeInstanceOf(ClarityBurstAbstainError);
    expect(fetchSpy).not.toHaveBeenCalled();

    routeSpy.mockRestore();
  });
});




