/**
 * FILE_SYSTEM_OPS Gate Real Chokepoint Prove Test
 *
 * This test exercises the REAL agent write path through createHostWorkspaceWriteTool
 * with workspaceOnly:false to prove that the FILE_SYSTEM_OPS gate is correctly wired
 * at the execution boundary (applyFileSystemOpsGateAndWrite).
 *
 * Architecture:
 * - The REAL code path runs: createHostWorkspaceWriteTool → createHostWriteOperations
 *   → applyFileSystemOpsGateAndWrite → applyFileSystemOverrides → routeClarityBurst
 * - Mock ONLY the router seam (routeClarityBurst) and pack loading (loadPackOrAbstain)
 * - Spy on the real fs.writeFile to verify block vs allow behavior
 * - NO mocks of applyFileSystemOverrides, applyFileSystemOpsGateAndWrite, or
 *   createHostWriteOperations (those are the code under test)
 *
 * Test A (fail-closed): Router throws → gate abstains → fs.writeFile never called
 * Test B (positive control): Router returns PROCEED → gate allows → fs.writeFile called
 */

import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OntologyPack } from "../pack-registry.js";
import type { RouterResult } from "../router-client.js";
import { createHostWorkspaceWriteTool } from "../../agents/pi-tools.read.js";
import configManager from "../config.js";

// Mock the router seam
vi.mock("../router-client.js", () => ({
  routeClarityBurst: vi.fn(),
}));

// Mock pack loading to supply a minimal valid FILE_SYSTEM_OPS pack
vi.mock("../pack-load.js", () => ({
  loadPackOrAbstain: vi.fn(),
}));

// Mock fs/promises to spy on writeFile and mkdir (the exact specifier the gate imports)
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    mkdir: vi.fn(actual.mkdir),
  };
});

import * as fsPromises from "fs/promises";
import { loadPackOrAbstain } from "../pack-load.js";
// Import the mocked functions after vi.mock declarations
import { routeClarityBurst } from "../router-client.js";

const mockedRouteClarityBurst = vi.mocked(routeClarityBurst);
const mockedLoadPackOrAbstain = vi.mocked(loadPackOrAbstain);

/**
 * Creates a minimal valid FILE_SYSTEM_OPS pack for testing
 */
function createMockFileSystemOpsPack(): OntologyPack {
  return {
    pack_id: "openclawd.FILE_SYSTEM_OPS_REAL_CHOKEPOINT_TEST",
    pack_version: "1.0.0",
    stage_id: "FILE_SYSTEM_OPS",
    description: "Test pack for FILE_SYSTEM_OPS real chokepoint validation",
    thresholds: {
      min_confidence_T: 0.55,
      dominance_margin_Delta: 0.1,
    },
    contracts: [
      {
        contract_id: "FS_WRITE_FILE",
        risk_class: "MEDIUM",
        required_fields: ["path", "content"],
        limits: {},
        needs_confirmation: false,
        deny_by_default: false,
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
 * Creates a PROCEED RouteResult that applyFileSystemOverridesImpl will accept
 */
function createProceedRouteResult(): RouterResult {
  return {
    ok: true,
    data: {
      top1: {
        contract_id: "FS_WRITE_FILE",
        score: 0.85,
      },
      top2: {
        contract_id: "FS_READ_FILE",
        score: 0.25,
      },
      router_version: "test-1.0.0",
      requestId: "test-request-id-proceed",
    },
  };
}

describe("FILE_SYSTEM_OPS Gate Real Chokepoint Prove Test", () => {
  let tmpRoot: string;

  beforeEach(() => {
    // Set ClarityBurst config environment variables for testing
    process.env.CLARITYBURST_ROUTER_URL = "http://localhost:3001";
    process.env.CLARITYBURST_ENABLED = "true";
    configManager.reset(); // Force re-read of env vars on next getConfig()

    // Create a unique tmp directory for each test
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "fs-ops-gate-test-"));

    // Reset the writeFile and mkdir spies (already mocked at module level)
    vi.mocked(fsPromises.writeFile).mockClear();
    vi.mocked(fsPromises.mkdir).mockClear();

    // Setup mock pack to return a valid FILE_SYSTEM_OPS pack
    const mockPack = createMockFileSystemOpsPack();
    mockedLoadPackOrAbstain.mockReturnValue(mockPack);

    // Reset router mock before each test
    mockedRouteClarityBurst.mockReset();
  });

  afterEach(async () => {
    // Clean up ClarityBurst config
    delete process.env.CLARITYBURST_ROUTER_URL;
    delete process.env.CLARITYBURST_ENABLED;
    configManager.reset(); // Clear cached config for next test

    // Clean up tmp directory
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {
        // Ignore cleanup errors
      });
    }

    // Restore all mocks
    vi.restoreAllMocks();
  });

  it("Test A: fail-closed (router throws) → gate abstains → fs.writeFile never called", async () => {
    // ARRANGE: Configure router mock to throw (simulates router outage)
    const routerError = new Error("Router unavailable (simulated outage)");
    mockedRouteClarityBurst.mockRejectedValue(routerError);

    // Create the real write tool with workspaceOnly:false to reach the gated path
    const writeTool = createHostWorkspaceWriteTool(tmpRoot, { workspaceOnly: false });

    // Target file path
    const targetPath = path.join(tmpRoot, "should-not-be-written.txt");

    // ACT: Attempt to write through the tool
    // VERIFY-ON-RUN: Confirm the rejection now originates from the router-outage/abstain
    // path (handleRouterOutageFailClosed in decision-override.ts) rather than config init
    // (config.ts:97 should NO LONGER appear in the stack trace)
    const executePromise = writeTool.execute(
      "test-call-1",
      { path: targetPath, content: "should-not-be-written" },
      undefined,
    );

    // ASSERT: The execute call should surface a block (rejection or error result)
    await expect(executePromise).rejects.toThrow();

    // The critical assertion: fs.writeFile must NOT have been called (fail-closed proof)
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledTimes(0);
  });

  it("Test B: positive control (router PROCEEDs) → gate allows → fs.writeFile called", async () => {
    // ARRANGE: Configure router mock to return PROCEED
    const proceedResult = createProceedRouteResult();
    mockedRouteClarityBurst.mockResolvedValue(proceedResult);

    // Create the real write tool with workspaceOnly:false
    const writeTool = createHostWorkspaceWriteTool(tmpRoot, { workspaceOnly: false });

    // Target file path
    const targetPath = path.join(tmpRoot, "should-be-written.txt");
    const testContent = "This content should be written";

    // ACT: Write through the tool
    const result = await writeTool.execute(
      "test-call-2",
      { path: targetPath, content: testContent },
      undefined,
    );

    // ASSERT: The execute call should succeed
    expect(result).toBeDefined();
    // VERIFY-ON-RUN: Check if result indicates success (may have isError: false or similar)

    // The critical assertion: fs.writeFile MUST have been called
    const writeFileSpy = vi.mocked(fsPromises.writeFile);
    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining("should-be-written.txt"),
      testContent,
      "utf-8",
    );

    // Verify the file was actually written (proves spy is live)
    const writtenContent = await fs.readFile(targetPath, "utf-8");
    expect(writtenContent).toBe(testContent);
  });

  describe("mkdir gating", () => {
    it("Test C: mkdir fail-closed (router throws) → gate abstains → fs.mkdir never called", async () => {
      // ARRANGE: Configure router mock to throw (simulates router outage)
      const routerError = new Error("Router unavailable (simulated outage)");
      mockedRouteClarityBurst.mockRejectedValue(routerError);

      // Create the real write tool with workspaceOnly:false to reach the gated mkdir path
      const writeTool = createHostWorkspaceWriteTool(tmpRoot, { workspaceOnly: false });

      // Target file path in a NEW subdir that doesn't exist yet
      const newSubdir = path.join(tmpRoot, "new-subdir-c");
      const targetPath = path.join(newSubdir, "test-file.txt");

      // ACT: Attempt to write through the tool (this calls mkdir first, then writeFile)
      const executePromise = writeTool.execute(
        "mkdir-call-1",
        { path: targetPath, content: "x" },
        undefined,
      );

      // ASSERT: The execute call should throw (mkdir gate blocks first)
      await expect(executePromise).rejects.toThrow();

      // The critical assertions: NEITHER fs.mkdir NOR fs.writeFile should have been called
      expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledTimes(0);
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledTimes(0);
    });

    it("Test D: mkdir positive control (router PROCEEDs) → gate allows → fs.mkdir called", async () => {
      // ARRANGE: Configure router mock to return PROCEED
      const proceedResult = createProceedRouteResult();
      mockedRouteClarityBurst.mockResolvedValue(proceedResult);

      // Create the real write tool with workspaceOnly:false
      const writeTool = createHostWorkspaceWriteTool(tmpRoot, { workspaceOnly: false });

      // Target file path in a NEW subdir that doesn't exist yet
      const newSubdir = path.join(tmpRoot, "new-subdir-d");
      const targetPath = path.join(newSubdir, "test-file.txt");
      const testContent = "mkdir allowed";

      // ACT: Write through the tool (this calls mkdir first, then writeFile)
      const result = await writeTool.execute(
        "mkdir-call-2",
        { path: targetPath, content: testContent },
        undefined,
      );

      // ASSERT: The execute call should succeed
      expect(result).toBeDefined();

      // The critical assertion: fs.mkdir MUST have been called (≥1)
      const mkdirSpy = vi.mocked(fsPromises.mkdir);
      expect(mkdirSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      // Verify writeFile was also called (proves the full path executed)
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
    });
  });
});
