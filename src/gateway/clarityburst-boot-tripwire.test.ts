import { describe, expect, it, vi } from "vitest";
import {
  CLARITYBURST_PLUGIN_ID,
  assertClarityBurstPluginActive,
  type TripwireDeps,
} from "./clarityburst-boot-tripwire.js";

function makeDeps(): TripwireDeps & {
  logError: ReturnType<typeof vi.fn>;
  logWarn: ReturnType<typeof vi.fn>;
} {
  const logError = vi.fn();
  const logWarn = vi.fn();
  const exit = vi.fn((code: number): never => {
    throw new Error(`__exit_${code}__`);
  });
  return { logError, logWarn, exit: exit as unknown as TripwireDeps["exit"] };
}

/** Empty env so the tripwire's test bypass never applies unless a test opts in. */
const noEnv: NodeJS.ProcessEnv = {};

const activeRecord = {
  id: CLARITYBURST_PLUGIN_ID,
  enabled: true,
  status: "loaded" as const,
};

describe("assertClarityBurstPluginActive (fail-closed boot tripwire)", () => {
  it("(a) proceeds when the plugin is loaded and enabled", () => {
    const deps = makeDeps();
    expect(() =>
      assertClarityBurstPluginActive({ plugins: [activeRecord] }, deps, noEnv),
    ).not.toThrow();
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it("(b) exits fatally when the plugin is disabled", () => {
    const deps = makeDeps();
    expect(() =>
      assertClarityBurstPluginActive(
        {
          plugins: [
            { id: CLARITYBURST_PLUGIN_ID, enabled: false, status: "disabled" },
          ],
        },
        deps,
        noEnv,
      ),
    ).toThrow("__exit_1__");
    expect(deps.logError).toHaveBeenCalledOnce();
    expect(String(deps.logError.mock.calls[0][0])).toContain("not active");
  });

  it("(b2) exits fatally when the plugin loaded with status error", () => {
    const deps = makeDeps();
    expect(() =>
      assertClarityBurstPluginActive(
        {
          plugins: [
            {
              id: CLARITYBURST_PLUGIN_ID,
              enabled: true,
              status: "error",
              error: "register() threw",
            },
          ],
        },
        deps,
        noEnv,
      ),
    ).toThrow("__exit_1__");
    expect(String(deps.logError.mock.calls[0][0])).toContain("register() threw");
  });

  it("(c) exits fatally when the plugin is missing entirely", () => {
    const deps = makeDeps();
    expect(() =>
      assertClarityBurstPluginActive({ plugins: [] }, deps, noEnv),
    ).toThrow("__exit_1__");
    expect(String(deps.logError.mock.calls[0][0])).toContain("not found in registry");
  });

  it("(c2) exits fatally when the registry is null or has an unexpected shape", () => {
    for (const bad of [null, undefined, {}, { plugins: "nope" }]) {
      const deps = makeDeps();
      expect(() =>
        assertClarityBurstPluginActive(bad as never, deps, noEnv),
      ).toThrow("__exit_1__");
    }
  });

  it("(d) exits fatally when the registry lookup throws unexpectedly", () => {
    const deps = makeDeps();
    const throwingRegistry = {
      get plugins(): unknown {
        throw new Error("registry exploded");
      },
    };
    expect(() =>
      assertClarityBurstPluginActive(throwingRegistry, deps, noEnv),
    ).toThrow("__exit_1__");
    expect(String(deps.logError.mock.calls[0][0])).toContain("threw unexpectedly");
  });

  describe("test bypass is narrow and never silent", () => {
    const missingRegistry = { plugins: [] };

    it('VITEST="1" alone does NOT bypass the tripwire', () => {
      const deps = makeDeps();
      expect(() =>
        assertClarityBurstPluginActive(missingRegistry, deps, { VITEST: "1" }),
      ).toThrow("__exit_1__");
      expect(deps.logWarn).not.toHaveBeenCalled();
    });

    it('VITEST="0" does NOT bypass the tripwire', () => {
      const deps = makeDeps();
      expect(() =>
        assertClarityBurstPluginActive(missingRegistry, deps, { VITEST: "0" }),
      ).toThrow("__exit_1__");
      expect(deps.logWarn).not.toHaveBeenCalled();
    });

    it('VITEST="true" alone (without OPENCLAW_TEST_MINIMAL_GATEWAY) does NOT bypass', () => {
      const deps = makeDeps();
      expect(() =>
        assertClarityBurstPluginActive(missingRegistry, deps, { VITEST: "true" }),
      ).toThrow("__exit_1__");
      expect(deps.logWarn).not.toHaveBeenCalled();
    });

    it('OPENCLAW_TEST_MINIMAL_GATEWAY="1" alone does NOT bypass', () => {
      const deps = makeDeps();
      expect(() =>
        assertClarityBurstPluginActive(missingRegistry, deps, {
          OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
        }),
      ).toThrow("__exit_1__");
      expect(deps.logWarn).not.toHaveBeenCalled();
    });

    it('only VITEST="true" AND OPENCLAW_TEST_MINIMAL_GATEWAY="1" bypasses, with a visible warning', () => {
      const deps = makeDeps();
      expect(() =>
        assertClarityBurstPluginActive(missingRegistry, deps, {
          VITEST: "true",
          OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
        }),
      ).not.toThrow();
      expect(deps.logError).not.toHaveBeenCalled();
      expect(deps.logWarn).toHaveBeenCalledOnce();
      expect(String(deps.logWarn.mock.calls[0][0])).toContain("BYPASSED");
    });
  });
});
