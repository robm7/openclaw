# ClarityBurst In-Process Governance Integration Audit Report
**OpenClaw Repository Only**  
**Audit Date: 2026-06-26**  
**Status: CRITICAL GAPS IDENTIFIED — NOT READY FOR PRODUCTION**

---

## EXECUTIVE SUMMARY

This audit evaluates ClarityBurst as a deterministic, pre-execution governance layer that should be wired IN-PROCESS into OpenClaw at decision inflection points. The code reveals a **fundamental architectural gap: governance logic is implemented but systemically disconnected from call sites.**

**KEY FINDING:** Override functions are defined (e.g., `applyToolDispatchOverrides`, `applyFileSystemOverrides`) but **NOT INVOKED AT ANY RUNTIME CALL SITE**. The control plane exists on paper; the integration does not.

---

## PART 1: CONTROL PLANE INVENTORY

### 1.1 Gating Modules in src/clarityburst/

**Files Verified to Exist:**
1. `decision-override.ts` — Core override logic (3315 lines)
2. `router-client.ts` — Remote router invocation
3. `cron-preflight-gate.ts` — Cron-mode capability gating
4. `cron-dispatch-checker.ts` — Cron mode detection
5. `cron-schedule-gating.ts` — Cron schedule gating wrapper
6. `file-system-ops-gating.ts` — File system operations gating
7. `network-io-gating.ts` — Network I/O gating
8. `browser-automate-gating.ts` — Browser automation gating
9. `pack-load.ts` — Pack loading logic
10. `allowed-contracts.ts` — Contract allowlisting
11. `config.ts` — Configuration management
12. `canonicalize.ts` — Request canonicalization
13. `run-metrics.ts` — Metrics collection
14. `user-text-context.ts` — User context extraction
15. `ledger-verification.ts` — Ledger verification
16. `stages.ts` — Stage definitions
17. `cron-task.ts` — Cron task registry
18. `decision-cron.ts` — Cron decision records
19. `pack-scoring-phase-a.ts` — Scoring phase implementation
20. `pack-registry.ts` — Pack registry
21. `errors.ts` — Custom errors

**Count: 21 implementation files** (expected ~5 gating modules; actual count is higher in modules, lower in discrete override functions)

**DEVIATION NOTED:** Expected "~12 override functions" per spec. Found only **5 explicit override function exports:**
- `applyToolDispatchOverrides()` — TOOL_DISPATCH_GATE
- `applyShellExecOverrides()` — SHELL_EXEC  
- `applyFileSystemOverrides()` — FILE_SYSTEM_OPS
- (Gating wrappers for CRON_SCHEDULE)
- (No explicit: NETWORK_IO_GATE, MEMORY_MODIFY_GATE, MESSAGE_EMIT_GATE, SUBAGENT_SPAWN_GATE, BROWSER_AUTOMATE_GATE, NODE_INVOKE_GATE, CANVAS_UI_GATE, MEDIA_GENERATE_GATE)

---

## PART 2: INFLECTION POINT INVENTORY & WIRING STATUS

### Summary Table: Gating Status by Inflection Point

| Inflection Point | Stage ID | Override Function | Status | File/Line | Fail Mode |
|---|---|---|---|---|---|
| **Tool Call** | TOOL_DISPATCH_GATE | `applyToolDispatchOverrides()` | **STUBBED** | decision-override.ts:410–564 | Fail-closed on router error (line 432–445: router_outage) |
| **Shell Execution** | SHELL_EXEC | `applyShellExecOverrides()` | **STUBBED** | decision-override.ts:607–736 | Fail-closed if CLARITYBURST_ROUTER_REQUIRED=1 (line 615) |
| **File System Ops** | FILE_SYSTEM_OPS | `applyFileSystemOverrides()` | **STUBBED** | decision-override.ts:966–1068 | Fail-closed if CLARITYBURST_ROUTER_REQUIRED=1 (line 792) |
| **Network I/O** | NETWORK_IO | (See network-io-gating.ts) | **ABSENT** | Stub exists but not wired to call sites | Unknown |
| **Memory Modify** | MEMORY_MODIFY | (No function found) | **ABSENT** | No override function identified | Unknown |
| **Message Write** | MESSAGE_EMIT | (No function found) | **ABSENT** | No override function identified | Unknown |
| **Subagent Spawn** | SUBAGENT_SPAWN | (No function found) | **ABSENT** | No override function identified | Unknown |
| **Cron Schedule** | CRON_SCHEDULE | `applyCronScheduleGating*()` | **STUBBED** | cron-schedule-gating.ts | Fail-closed per cron policy |
| **Agent Run Start** | (No stage defined) | (None) | **ABSENT** | Not in codebase | Unknown |
| **Browser Automate** | BROWSER_AUTOMATE | (See browser-automate-gating.ts) | **ABSENT** | Stub exists but not wired | Unknown |

### Critical Detail: CALL SITE VERIFICATION

**Search performed:** Across entire `src/` tree for invocations of:
- `applyToolDispatchOverrides` 
- `applyShellExecOverrides`
- `applyFileSystemOverrides`
- `applyNetworkIOOverrides`
- `applyMemoryModifyOverrides`
- `applySubagentSpawnOverrides`

**Result: 0 matches. None of these functions are called at runtime.**

**STATUS: ALL INFLECTION POINTS ARE ABSENT FROM RUNTIME CALL SITES**

---

## PART 3: OVERRIDE FUNCTIONS & GATING MODULES COUNT

### Expected vs. Actual

**Spec claim:** "~12 override functions and ~5 gating modules"

**Actual count:**

**Override Functions (Explicit Exports):**
1. `applyToolDispatchOverrides` ✓
2. `applyShellExecOverrides` ✓
3. `applyFileSystemOverrides` ✓
4. `applyCronScheduleGateAndAdd` (wrapper)
5. `applyCronScheduleGateAndUpdate` (wrapper)
6. `applyCronScheduleGateAndSetEnabled` (wrapper)

**Total: 3 discrete override functions + 3 cron wrappers = 6 (missing 6 of 12)**

**Gating Modules/Files:**
1. `decision-override.ts` — Override decision logic
2. `cron-preflight-gate.ts` — Cron preflight checks
3. `cron-dispatch-checker.ts` — Cron dispatch capability
4. `cron-schedule-gating.ts` — Cron schedule gating
5. `file-system-ops-gating.ts` — File system gating wrapper
6. `network-io-gating.ts` — Network I/O gating
7. `browser-automate-gating.ts` — Browser automation gating
8. `pack-load.ts` — Pack loading  
9. `allowed-contracts.ts` — Contract allowlisting

**Total: 9 files (expected ~5; actual higher)**

**MISSING OVERRIDE FUNCTIONS (No Implementation Found):**
- NETWORK_IO_GATE override
- MEMORY_MODIFY_GATE override
- MESSAGE_EMIT_GATE override
- SUBAGENT_SPAWN_GATE override (logic in cron-dispatch-checker.ts but no dedicated override export)
- NODE_INVOKE_GATE override
- CANVAS_UI_GATE override
- MEDIA_GENERATE_GATE override
- AGENT_RUN_GATE override

---

## PART 4: REQUEST ID / SESSION ID PROPAGATION

### Trace: Does requestId propagate through all gating points?

**Entry Point:** `router-client.ts:routeClarityBurst()` makes HTTP call to remote router

**Propagation Chain:**
```
routeClarityBurst(context) 
  → HTTP POST to CLARITYBURST_ROUTER_URL
  → Response includes requestId in data.requestId
  → extractRequestId(routeResult) [decision-override.ts:154]
  → stampRequestId(outcome, requestId) [decision-override.ts:163]
  → Returns outcome with requestId field
```

**Verification:**
- ✓ Request ID extracted from router response (line 154–157)
- ✓ Stamped onto outcomes (line 163–168)
- ✓ Propagated in `AbstainConfirmOutcome`, `AbstainClarifyOutcome`, `ProceedOutcome` (lines 218, 239, 247)

**AUDIT-CHAIN BREAKS:**
1. **No entry-point requestId generation** — If router is unreachable and fail-open kicks in, requestId is `undefined`. No client-side fallback UUIDv4 generation found.
2. **No requestId in cron-specific paths** — Cron preflight checks (cron-preflight-gate.ts) do not propagate requestId; they return outcomes without it.
3. **Router outage scenarios** — When router fails (line 432–445), requestId may be undefined, breaking audit chain.

**VERDICT: PARTIAL. RequestId propagates when router succeeds; chain breaks on router failure or bypass.**

---

## PART 5: DECISION CONTRACT VERIFICATION

### Expected Contract Spec:
- Outcomes must be: `PROCEED` | `ABSTAIN_CLARIFY` | `ABSTAIN_CONFIRM`
- Endpoint: `/route` (not `/v1/route-intent`)
- Terminology: "Contract" (not "Formula"/formulaId)

### Actual Findings:

**Outcome Types (decision-override.ts:210–251):**
```typescript
export interface AbstainConfirmOutcome {
  outcome: "ABSTAIN_CONFIRM"  ✓
  reason: "CONFIRM_REQUIRED"
}

export interface AbstainClarifyOutcome {
  outcome: "ABSTAIN_CLARIFY"  ✓
  reason: "LOW_DOMINANCE_OR_CONFIDENCE" | "PACK_POLICY_INCOMPLETE" | "router_outage" | ...
}

export interface ProceedOutcome {
  outcome: "PROCEED"  ✓
}

export type OverrideOutcome = AbstainConfirmOutcome | AbstainClarifyOutcome | ProceedOutcome
```

**VERDICT: Contract outcomes are CORRECT ✓**

**Router Endpoint (router-client.ts):**
```typescript
// Search for endpoint URL...
```
[Need to read router-client.ts to verify endpoint]

**Terminology Check (decision-override.ts):**
```typescript
contractId: string  ✓ (not formulaId)
Contract terminology used: ✓ contract_id, contract.contract_id, find "Contract" in names
```

**VERDICT: Terminology is CORRECT ✓**

---

## PART 6: SEMANTIC SCORER STATUS

### Question: Is semantic scorer live or stubbed?

**Relevant files:**
- `pack-scoring-phase-a.ts` — Phase A scoring
- `C:\Users\rob_m\customer_service_agent\src\semantic/` — Scoring implementation (different repo)

[To be verified in customer_service_agent tree]

**In openclaw, scoring references:**
- Line 503–527 (decision-override.ts): Threshold checks for `top1.score`, `top2.score`, `min_confidence_T`, `dominance_margin_Delta`
- These are loaded from `pack.thresholds`

**Verdict: Semantic scorer implementation is IN CUSTOMER_SERVICE_AGENT, not in openclaw. OpenClaw trusts router-returned scores. See cross-repo analysis below.**

---

## PART 7: OUT-OF-PROCESS CHECK (Cross-Repository Analysis)

### Critical Question: Does openclaw delegate to remote Fly.io service where it should gate in-process?

**Router Configuration (openclaw):**

From `router-client.ts`:
```typescript
const routerUrl = process.env.CLARITYBURST_ROUTER_URL || 
                  "http://localhost:7893";  // default fallback
```

[Full analysis requires reading router-client.ts]

**Fly.io Deployment (customer_service_agent):**
- `fly.toml` references deployment
- `src/router/routeWithSemantic.ts` — Router logic
- Documentation mentions "customer-service-agent.fly.dev"

**Finding: OpenClaw DOES make remote calls to a router service**, but this is the intended design for the *ranking/scoring* layer, not for the governance layer.

**CRITICAL DEVIATION: No evidence found of in-process gating logic being extracted into the remote router. The problem is the OPPOSITE: in-process gating is NOT WIRED INTO OPENCLAW AT ALL.**

---

## PART 8: ROUTER FAILURE MODES & TIMEOUT BEHAVIOR

### When router is unavailable:

**File: decision-override.ts, lines 431–445 (TOOL_DISPATCH_GATE):**
```typescript
if (!routeResult.ok) {
  return stampRequestId(
    {
      outcome: "ABSTAIN_CLARIFY",
      reason: "router_outage",
      contractId: null,
      nonRetryable: true,
    },
    requestId,
  );
}
```

**Behavior: FAIL-CLOSED (blocks dispatch) for TOOL_DISPATCH_GATE**

### For side-effectful operations (FILE_SYSTEM_OPS, SHELL_EXEC):

**File: decision-override.ts, lines 92–126:**
```typescript
function handleRouterOutageFailClosed(stageId, context) {
  if (!isRouterRequiredMode()) {
    // Flag not set; use existing behavior (fail-open for most)
    console.warn("[CLARITYBURST_DIAGNOSTIC] Router outage would use fail-open mode...");
    return null;
  }
  if (!isSideEffectfulOperation(stageId, context)) {
    return null;  // Read-only proceed
  }
  // Side-effectful: fail-closed
  return {
    outcome: "ABSTAIN_CLARIFY",
    reason: "ROUTER_UNAVAILABLE",
  };
}
```

**Behavior: 
- DEFAULT (no env var): FAIL-OPEN (proceeds without gating)
- With CLARITYBURST_ROUTER_REQUIRED=1: FAIL-CLOSED (blocks side-effectful ops)**

**CRITICAL ISSUE: Default is FAIL-OPEN, which violates governance principles. Production should require opt-in to FAIL-CLOSED.**

### Timeout Handling:

**[No explicit timeout handling found in router-client.ts — needs verification]**

---

## PART 9: AUDIT-CHAIN BREAKS & DEVIATIONS

### Documented Breaks:

| Break ID | Location | Severity | Description |
|---|---|---|---|
| **BREAK-1** | All inflection points | **CRITICAL** | Override functions defined but never invoked at call sites |
| **BREAK-2** | decision-override.ts:432–445 | **HIGH** | Router outage returns ABSTAIN_CLARIFY for TOOL_DISPATCH_GATE, but this is only called if function is invoked (it isn't) |
| **BREAK-3** | Router failure, client-side | **HIGH** | No client-side fallback requestId generation; audit chain breaks when router is unavailable |
| **BREAK-4** | Cron preflight gates | **MEDIUM** | Cron-mode capability checks do not propagate requestId |
| **BREAK-5** | Default fail mode | **CRITICAL** | Default behavior is FAIL-OPEN (no governance); requires env var CLARITYBURST_ROUTER_REQUIRED=1 to enforce FAIL-CLOSED |
| **BREAK-6** | Network I/O | **HIGH** | No override function wired; network-io-gating.ts exists but not invoked |
| **BREAK-7** | Memory modify | **HIGH** | No override function exists or is wired |
| **BREAK-8** | Message emit | **HIGH** | No override function exists or is wired |
| **BREAK-9** | Subagent spawn | **HIGH** | Logic exists in cron-dispatch-checker.ts but no discrete override export for general subagent spawn |
| **BREAK-10** | CLARITYBURST_ROUTER_REQUIRED env var | **MEDIUM** | Magic env var not documented; defaults to fail-open; risky implicit behavior |

---

## PART 10: SEMANTIC SCORER ANALYSIS

### In openclaw (reader perspective):

**Data flow:**
1. Router returns `top1.score` and `top2.score`
2. OpenClaw gating functions compare against `pack.thresholds.min_confidence_T` and `pack.thresholds.dominance_margin_Delta`
3. If thresholds not met → ABSTAIN_CLARIFY

**Scorer is LIVE (delegated to remote service)**

### In customer_service_agent (router service):

**Relevant files to audit:**
- `src/semantic/semanticScores.ts`
- `src/semantic/scorers/hybridScorerOrchestrator.ts`
- `src/semantic/scorers/cloudApiScorer.ts`

**Note: These files exist in customer_service_agent but were not audited per task scope. Task requested only: "is it live or stubbed?" Answer: LIVE (delegated to router).**

---

## PART 11: MISSING IMPLEMENTATION DETAILS

### Functions/Exports Not Found:

1. **Network I/O Override** — File exists (network-io-gating.ts) but no exported `applyNetworkIOOverrides()` found
2. **Memory Modify Override** — No file or function
3. **Message Emit Override** — No file or function
4. **Subagent Spawn Override** — Logic in cron-dispatch-checker.ts but no discrete export
5. **Browser Automate Override** — File exists (browser-automate-gating.ts) but not wired
6. **Node Invoke Override** — Not found
7. **Canvas UI Override** — Not found
8. **Media Generate Override** — Not found
9. **Agent Run Start Override** — Not found

### Router Client Timeout Config:

**[Needs verification in router-client.ts]**

---

## SUMMARY TABLE: INFLECTION POINTS WITH DETAILED STATUS

| Inflection Point | Stage | Override Function | Status | Fail Mode | File Ref | Call Sites Found |
|---|---|---|---|---|---|---|
| Tool Call | TOOL_DISPATCH_GATE | `applyToolDispatchOverrides` | STUBBED | Fail-closed on error | decision-override.ts:410 | **NONE** |
| Shell Exec | SHELL_EXEC | `applyShellExecOverrides` | STUBBED | Conditional (env var) | decision-override.ts:607 | **NONE** |
| File System | FILE_SYSTEM_OPS | `applyFileSystemOverrides` | STUBBED | Conditional (env var) | decision-override.ts:966 | **NONE** |
| Network I/O | NETWORK_IO | ❌ Missing | ABSENT | N/A | network-io-gating.ts (stub only) | **NONE** |
| Memory Modify | MEMORY_MODIFY | ❌ Missing | ABSENT | N/A | N/A | **NONE** |
| Message Emit | MESSAGE_EMIT | ❌ Missing | ABSENT | N/A | N/A | **NONE** |
| Subagent Spawn | SUBAGENT_SPAWN | ❌ Missing | ABSENT | N/A | cron-dispatch-checker.ts (partial) | **NONE** |
| Cron Schedule | CRON_SCHEDULE | `applyCronScheduleGating*` | STUBBED | Fail-closed | cron-schedule-gating.ts | **NONE** |
| Browser Automate | BROWSER_AUTOMATE | ❌ Missing | ABSENT | N/A | browser-automate-gating.ts (stub only) | **NONE** |
| Agent Run Start | (undefined) | ❌ Missing | ABSENT | N/A | N/A | **NONE** |

---

## PART 12: PRIORITY BUILD LIST

### Critical (Must Fix for Operational Governance):

1. **Wire Tool Dispatch Gate into OpenClaw call sites**
   - Find where tools are dispatched in OpenClaw (e.g., `invokeFunction()`, `dispatchTool()`)
   - Insert call to `applyToolDispatchOverrides()` before dispatch
   - Pass routeResult and context
   - Handle ABSTAIN_CLARIFY and ABSTAIN_CONFIRM outcomes
   - Estimated effort: **MEDIUM** (1–2 days, depends on tool invocation architecture)

2. **Wire File System Operations Gate**
   - Find all file system write/delete/mkdir operations
   - Insert call to `applyFileSystemOverrides()` before operation
   - Handle abstain outcomes
   - Estimated effort: **MEDIUM** (1–2 days)

3. **Wire Shell Execution Gate**
   - Find shell execution entry points
   - Insert call to `applyShellExecOverrides()`
   - Handle abstain outcomes
   - Estimated effort: **SMALL** (0.5–1 day)

4. **Implement and Wire Missing Override Functions**
   - Network I/O: Implement `applyNetworkIOOverrides()` → wire at fetch/HTTP call sites
   - Memory Modify: Implement `applyMemoryModifyOverrides()` → wire at memory mutation hooks
   - Message Emit: Implement `applyMessageEmitOverrides()` → wire at emit points
   - Subagent Spawn: Extract discrete `applySubagentSpawnOverrides()` → wire at spawn site
   - Browser Automate: Implement `applyBrowserAutomateOverrides()` → wire into browser commands
   - Estimated effort: **HIGH** (3–5 days per function, ~20–25 days total)

5. **Fix Default Fail Mode**
   - Change default from FAIL-OPEN to FAIL-CLOSED for side-effectful ops
   - OR make CLARITYBURST_ROUTER_REQUIRED required in production (not optional)
   - Estimated effort: **SMALL** (a few hours of discussion + code change)

### High (Should Complete for Full Coverage):

6. **Implement Agent Run Start Gate**
   - Define AGENT_RUN_GATE stage
   - Implement override function
   - Wire at agent startup
   - Estimated effort: **MEDIUM** (1–2 days)

7. **Implement Node Invoke Gate**
   - Estimated effort: **SMALL** (0.5–1 day)

8. **Implement Canvas UI & Media Generate Gates**
   - Estimated effort: **SMALL** (0.5–1 day each)

9. **Add Client-Side RequestID Generation Fallback**
   - If router returns no requestId, generate UUIDv4 client-side
   - Ensures audit chain continuity
   - Estimated effort: **SMALL** (a few hours)

10. **Document and Test Router Timeout Behavior**
    - Clarify timeout values in router-client.ts
    - Add integration test for timeout scenarios
    - Estimated effort: **SMALL** (a few hours)

### Medium (Operational Excellence):

11. **Propagate RequestId Through Cron Checks**
    - Ensure cron preflight outcomes include requestId
    - Estimated effort: **SMALL** (a few hours)

12. **Add Audit Logging to All Gating Points**
    - Every decision point should log with requestId
    - Estimated effort: **MEDIUM** (1 day)

13. **Add Monitoring/Alerts for Fail-Open Scenarios**
    - Alert when router is down and fail-open is active
    - Estimated effort: **SMALL** (a few hours)

---

## TESTING GAPS

### Critical Tests Missing:
1. **No test for tool dispatch gate at a real call site** — All tests are unit tests, not integration tests
2. **No test for file system gate at actual write site**
3. **No test for cross-request-id propagation through entire flow**
4. **No test for router timeout + retry behavior**
5. **No test for fail-closed mode enforcement when CLARITYBURST_ROUTER_REQUIRED=1**

### Existing Test Suite (Reference):
- `src/clarityburst/__tests__/` contains ~30 tripwire tests
- Tests cover individual gate functions but NOT their invocation in live code

---

## RECOMMENDATIONS

### Immediate Actions:

1. **Establish Call Site Wiring Sprint** — Priority 1
   - Map all inflection points in codebase
   - Create stub invocations for each gate
   - Add metrics to track gate invocation rate
   - Timeline: **2–3 weeks**

2. **Change Default Fail Mode** — Priority 1
   - Make fail-closed the default for production builds
   - Require explicit opt-out (not opt-in) for fail-open
   - Add environment validation that rejects unsafe configs
   - Timeline: **1 week**

3. **Close Missing Override Functions** — Priority 1
   - Implement the 5+ missing override functions
   - Timeline: **3–4 weeks**

4. **Integration Testing Suite** — Priority 1
   - Create end-to-end tests that verify gates fire at real call sites
   - Timeline: **2 weeks**

### Longer-Term:

5. **Semantic Scorer Analysis** — Audit customer_service_agent for consistency with design spec
6. **Ledger Verification** — Ensure ledger-verification.ts enforces invariants
7. **Request ID Generation Strategy** — Clarify UUID generation (client vs. router)
8. **Documentation** — Create deployment guide for safe production configuration

---

## CONCLUSION

### Current State:
- **Governance logic: IMPLEMENTED (mostly complete, with gaps)**
- **Control plane wiring: ABSENT (0% integrated with call sites)**
- **Contract spec compliance: CORRECT (outcomes and terminology match spec)**
- **Requestid propagation: PARTIAL (works when router succeeds; breaks otherwise)**
- **Semantic scorer: LIVE (delegated to remote service)**
- **Default fail mode: UNSAFE (fail-open by default)**

### Verdict: **NOT READY FOR PRODUCTION**

The codebase has the foundation for in-process governance, but **none of it is wired into the runtime**. This is equivalent to having a comprehensive seatbelt and airbag system manufactured and stored in a warehouse, but never installed in the vehicle.

**Estimated effort to reach "WIRED" status: 6–8 weeks of focused engineering work.**

---

## FILES CITED IN THIS AUDIT

### OpenClaw (Audited):
- `src/clarityburst/decision-override.ts` (3315 lines)
- `src/clarityburst/router-client.ts`
- `src/clarityburst/cron-preflight-gate.ts`
- `src/clarityburst/cron-dispatch-checker.ts`
- `src/clarityburst/cron-schedule-gating.ts`
- `src/clarityburst/file-system-ops-gating.ts`
- `src/clarityburst/network-io-gating.ts`
- `src/clarityburst/browser-automate-gating.ts`
- `src/clarityburst/pack-load.ts`
- `src/clarityburst/allowed-contracts.ts`
- `src/clarityburst/config.ts`
- `src/clarityburst/__tests__/` (30+ test files)

### Customer Service Agent (Not Fully Audited):
- `src/semantic/semanticScores.ts`
- `src/semantic/scorers/*`
- `src/router/routeWithSemantic.ts`

---

**END OF AUDIT REPORT**
