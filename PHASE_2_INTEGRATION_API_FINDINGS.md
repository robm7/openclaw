# Phase 2 Integration API Findings

## Executive Summary

Investigation into the actual integration surface revealed **7 critical errors** in shell-exec-gate.ts caused by invented APIs rather than using what actually exists. This document records the REAL API surface for correct implementation.

---

## 1. Pack Loading API

### ❌ INVENTED (used in gate)
```typescript
import { getClarityOntologyPack } from "./runtime-integration.js";
```

### ✅ ACTUAL (exists in codebase)
```typescript
import { loadPackOrAbstain } from "./pack-load.js";
import type { OntologyPack } from "./pack-registry.js";

// Function signature:
function loadPackOrAbstain(stageId: ClarityBurstStageId): OntologyPack

// Throws ClarityBurstAbstainError on failure (pack-incomplete, validation errors)
// Returns OntologyPack directly on success
```

**Location**: `src/clarityburst/pack-load.ts`  
**Used throughout decision-override.ts** (line 20 import, used inline for SHELL_EXEC stage)

---

## 2. Router API

### ❌ INVENTED (used in gate)
```typescript
import { getClarityLastRouteResult } from "./runtime-integration.js";
import type { RouteResult } from "./router-client.js";
```

### ✅ ACTUAL (exists in codebase)
```typescript
import { routeClarityBurst, type RouterResult, type RouterInput } from "./router-client.js";

// Type definitions:
export type RouterResult = RouterResultOk | RouterResultError;

export type RouterResultOk = {
  ok: true;
  data: RouterResponseData; // contains top1, top2, requestId, etc.
};

export type RouterResultError = {
  ok: false;
  error: string;
  status?: number;
  disabled?: true;
};

// Function signature:
async function routeClarityBurst(input: RouterInput): Promise<RouterResult>

// RouterInput requires:
interface RouterInput {
  stageId: string;
  packId: string;
  packVersion: string;
  allowedContractIds: string[];
  userText: string;
  context?: Record<string, unknown>;
  pack?: OntologyPack;  // Include when already loaded
  sessionId?: string;
}
```

**Location**: `src/clarityburst/router-client.ts` (lines 24-60, 138+)  
**Type name is `RouterResult` NOT `RouteResult`**  
**No "last route result" caching mechanism exists** - gate must call routeClarityBurst to route THIS command

---

## 3. Abstain Outcome Types

### ❌ INVENTED (used in gate)
```typescript
reason: gateOutcome.message || "fallback"
```

### ✅ ACTUAL (exists in codebase)
```typescript
export interface AbstainClarifyOutcome {
  outcome: "ABSTAIN_CLARIFY";
  reason: "LOW_DOMINANCE_OR_CONFIDENCE" 
        | "PACK_POLICY_INCOMPLETE" 
        | "router_outage" 
        | "capability_denied" 
        | "ROUTER_UNAVAILABLE" 
        | "EXCEEDS_FILE_SIZE_LIMIT" 
        | "ROUTER_MISMATCH" 
        | "api_key_required";
  contractId: string | null;
  stageId?: string;
  instructions?: string;  // ← THE FIELD IS "instructions" NOT "message"
  requestId?: string;
}

export interface AbstainConfirmOutcome {
  outcome: "ABSTAIN_CONFIRM";
  reason: "CONFIRM_REQUIRED";
  contractId: string;
  instructions?: string;  // ← THE FIELD IS "instructions" NOT "message"
  requestId?: string;
}
```

**Location**: `src/clarityburst/decision-override.ts` (lines 227-256)  
**Field name**: `instructions` (optional string)  
**NOT `message`** - reading .message causes "Property 'message' does not exist" errors

---

## 4. Readiness Check

### ❌ INVENTED (used in gate)
```typescript
import { clarityCoreIsReady } from "../infra/runtime-guard.js";
```

### ✅ ACTUAL
**NO readiness check function exists in runtime-guard.ts or elsewhere.**

The gate should NOT gate on "readiness" - either:
1. Call routeClarityBurst and handle RouterResultError (ok: false)
2. Trust that disabled/outage states are already handled by router-client.ts internally

**runtime-guard.ts exports**:
- `guardNodeInvoke` (function)
- Various guard-related types
- NO `clarityCoreIsReady` function

---

## 5. Type Export Issues

### ❌ INVENTED (typecheck error)
```typescript
import type { OntologyPack } from "./router-client.js";
```

**Error**: `Module declares 'OntologyPack' locally, but it is not exported`

### ✅ ACTUAL
```typescript
import type { OntologyPack } from "./pack-registry.js";
```

**router-client.ts imports OntologyPack from pack-registry** (line 5) but does NOT re-export it.  
Gate must import directly from pack-registry.js.

---

## 6. Missing Module

### ❌ INVENTED
```typescript
import { ... } from "./runtime-integration.js";
```

**Typecheck error**: `Cannot find module './runtime-integration.js'`

### ✅ ACTUAL
**This module does not exist.** All gate integration must use:
- `loadPackOrAbstain` from pack-load.js
- `routeClarityBurst` from router-client.js  
- `applyShellExecOverrides` from decision-override.js

---

## 7. Correct Override Integration

### ✅ ACTUAL Pattern (from decision-override.ts SHELL_EXEC handling)

```typescript
import { loadPackOrAbstain } from "./pack-load.js";
import { routeClarityBurst, type RouterResult } from "./router-client.js";
import { applyShellExecOverrides, type ShellExecContext } from "./decision-override.js";
import type { OntologyPack } from "./pack-registry.js";

// 1. Load pack (throws on failure)
const pack: OntologyPack = loadPackOrAbstain("SHELL_EXEC");

// 2. Build router input
const routerInput = {
  stageId: "SHELL_EXEC",
  packId: pack.pack_id,
  packVersion: pack.pack_version,
  allowedContractIds: /* derive from pack */,
  userText: command,  // The command to route
  context: { operation: "exec", ... },
  pack,  // Include for efficiency
};

// 3. Call router
const routeResult: RouterResult = await routeClarityBurst(routerInput);

// 4. Apply overrides (handles outages, confirmation, proceed logic)
const context: ShellExecContext = { operation: "exec", command };
const outcome = await applyShellExecOverrides(pack, routeResult, context);

// 5. Handle outcome
if (outcome.outcome !== "PROCEED") {
  // Block: return { allowed: false, reason: outcome.instructions || fallback }
}
// Proceed: return { allowed: true }
```

---

## Summary of Required Corrections

| Issue | Current (Wrong) | Required (Correct) |
|-------|----------------|-------------------|
| Pack loading | `getClarityOntologyPack()` | `loadPackOrAbstain(stageId)` |
| Routing | `getClarityLastRouteResult()` | `await routeClarityBurst(input)` |
| Router type | `RouteResult` | `RouterResult` |
| OntologyPack import | from router-client | from pack-registry |
| Outcome field | `.message` | `.instructions` |
| Readiness check | `clarityCoreIsReady()` | (none - handle router errors) |
| runtime-integration | imported | (does not exist) |

**All 7 typecheck errors stem from these invented APIs.**

---

## Next Steps

1. **Do NOT fix** shell-exec-gate.ts yet - user wants to see this analysis first
2. Gate must call `routeClarityBurst(input)` with current command as `userText`
3. Gate must NOT use cached "last route result" - route THIS specific command
4. Use `instructions` field from outcomes, not `message`
5. Import OntologyPack from pack-registry.js
6. Remove readiness check - trust router-client's internal error handling

**Baseline**: 149 errors  
**Current**: 156 errors (+7 all in shell-exec-gate.ts)  
**Call sites**: Both compile cleanly (0 new errors in bash-tools.exec.ts or bash-tools.exec-host-node.ts)
