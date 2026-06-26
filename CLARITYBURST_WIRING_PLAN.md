# ClarityBurst Governance Wiring Plan

**Purpose:** Track integration of ClarityBurst's in-process governance gating logic into OpenClaw. The audit (CLARITYBURST_INTEGRATION_READINESS_AUDIT.md) identified that gating logic exists but has zero runtime call sites and a fail-open default.

## How to use this doc

Every gate goes through the same 3-step cycle:
1. **Narrow Audit** — locate the real call site; confirm behavior on success / error / timeout
2. **Wire** — insert the gate at that call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM)
3. **Prove** — adversarial test (kill router, simulate outage, etc.) and assert expected behavior

No gate is marked done until its Prove step passes. Within each phase, one inflection point is completed fully before the next begins.

---

## Phase 0 — Make the default safe (DO THIS FIRST, before any wiring)

- [ ] Flip handleRouterOutageFailClosed (decision-override.ts ~lines 92–126) so fail-CLOSED is the default for side-effectful operations; fail-open must require explicit opt-out, not opt-in.
- [ ] Add startup config validation that refuses to boot in production mode if fail-open is active.
- [ ] Prove: with no env var set, simulate a router outage and confirm a side-effectful op is BLOCKED.

---

## Pre-wiring verifications (resolve before Phase 1)

The audit left these unconfirmed. Resolve before proceeding to Phase 1:

- [ ] Confirm the real router endpoint string in router-client.ts (/route vs /v1/route-intent).
- [ ] Confirm which router URL is actually live (audit cited a localhost:7893 default — verify against the deployed Fly.io router).
- [ ] Confirm router-client timeout behavior: is there a timeout at all? When it fires, does it route to the same fail-closed path as Phase 0? If no timeout exists, that is a finding to fix.

---

## Phase 1 — Wire the three gates that already exist

For EACH gate below, create the same 3-item sub-checklist (Narrow Audit / Wire / Prove). Complete one gate fully before moving to the next.

### Shell Exec (applyShellExecOverrides, decision-override.ts:607)

**Priority: HIGHEST** — currently unwired AND fail-open

- [ ] Narrow Audit: locate OpenClaw's actual shell-dispatch call site; confirm the gate's behavior on router success / error / timeout.
- [ ] Wire: insert the gate at that call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert the shell command is BLOCKED.

### File System Ops (applyFileSystemOverrides, decision-override.ts:966)

- [ ] Narrow Audit: locate OpenClaw's actual file-system call site; confirm the gate's behavior on router success / error / timeout.
- [ ] Wire: insert the gate at that call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert the file-system operation is BLOCKED.

### Tool Dispatch (applyToolDispatchOverrides, decision-override.ts:410)

- [ ] Narrow Audit: locate OpenClaw's actual tool-dispatch call site; confirm the gate's behavior on router success / error / timeout.
- [ ] Wire: insert the gate at that call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert the tool dispatch is BLOCKED.

---

## Phase 2 — Adversarial proof is built into each Phase 1 gate

The Prove step in each Phase 1 gate is your adversarial proof. Add one cross-cutting item:

- [ ] Confirm NO existing test is a unit test masquerading as integration coverage — at least one test must invoke a gate at a real call site (the audit found all ~30 existing tests never do).

---

## Phase 3 — Complete gates whose logic already exists (just missing export + wiring)

For EACH gate below, create the same 3-item sub-checklist (Narrow Audit / Wire / Prove). Complete one gate fully before moving to the next.

### Network I/O (network-io-gating.ts exists; needs applyNetworkIOOverrides export + wiring)

- [ ] Narrow Audit: locate OpenClaw's actual network-I/O call site; confirm the gate's behavior on router success / error / timeout.
- [ ] Wire: insert the gate at that call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert the network I/O operation is BLOCKED.

### Browser Automate (browser-automate-gating.ts exists; needs applyBrowserAutomateOverrides export + wiring)

- [ ] Narrow Audit: locate OpenClaw's actual browser-automation call site; confirm the gate's behavior on router success / error / timeout.
- [ ] Wire: insert the gate at that call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert the browser automation is BLOCKED.

### Subagent Spawn (partial logic in cron-dispatch-checker.ts; extract a discrete override + wire)

- [ ] Narrow Audit: extract discrete override from cron-dispatch-checker.ts; locate OpenClaw's subagent-spawn call site; confirm the gate's behavior on router success / error / timeout.
- [ ] Wire: insert the gate at that call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert the subagent spawn is BLOCKED.

---

## Phase 4 — Genuine new construction (no existing file/function)

For EACH gate below, create the same 3-item sub-checklist (Narrow Audit / Wire / Prove). Complete one gate fully before moving to the next.

### Memory Modify (MEMORY_MODIFY — no file, no function; build from scratch)

- [ ] Narrow Audit: identify OpenClaw's memory-modification call site; design gate behavior on router success / error / timeout.
- [ ] Wire: create gate logic; insert at call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert memory modification is BLOCKED.

### Message Emit

- [ ] Narrow Audit: identify OpenClaw's message-emission call site; design gate behavior on router success / error / timeout.
- [ ] Wire: create gate logic; insert at call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert message emission is BLOCKED.

### Agent Run Start

- [ ] Narrow Audit: identify OpenClaw's agent-run-start call site; design gate behavior on router success / error / timeout.
- [ ] Wire: create gate logic; insert at call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert agent run start is BLOCKED.

### Node Invoke

- [ ] Narrow Audit: identify OpenClaw's node-invoke call site; design gate behavior on router success / error / timeout.
- [ ] Wire: create gate logic; insert at call site; handle all three outcomes (PROCEED / ABSTAIN_CLARIFY / ABSTAIN_CONFIRM).
- [ ] Prove: kill the router mid-call; assert node invoke is BLOCKED.

---

## Phase 5 — Audit-chain hardening

- [ ] Client-side requestId fallback: generate a UUIDv4 client-side when the router returns none, so the audit chain doesn't break on router failure (audit BREAK-3).
- [ ] Propagate requestId through cron preflight paths (audit BREAK-4).

---

## Open Questions

*Note any items that could not be mapped cleanly during document creation.*

### Phase 1 Known Limitation: Capability Filtering

**Issue:** SHELL_EXEC gate passes `createFullCapabilities()` which asserts all capabilities enabled — AND uses `deriveAllowedForDefaultStage` which never checks `capability_requirements` at all (only TOOL_DISPATCH_GATE's derivation path does). Capability-scoped contract filtering is therefore doubly inactive:

1. **Stubbed inputs** — no source of truth for "is shell enabled / is network enabled in this actual execution context"
2. **Non-consulting derivation path** — `deriveAllowedForDefaultStage` doesn't examine capability_requirements even if they were real

**Active filtering for SHELL_EXEC:** CRITICAL deny_by_default exclusion + empty-list failsafe + router's own routing decision. That's the accurate scope.

**Status:** Acceptable for Phase 1 — CRITICAL-deny filtering + fail-closed + routing decision is a legitimate Phase-1 gate.

**Future work:** Fix capability sourcing AND wire SHELL_EXEC to capability-aware derivation (or add capability_requirements checks to default path).

**Tracking:** This limitation is documented, not assumed. Fixing capability sourcing alone won't enable capability-scoped filtering for SHELL_EXEC — the derivation path must also be changed.

**Reference:** See `PHASE_2_CAPABILITY_FILTERING_ANALYSIS.md` in customer_service_agent repo for detailed analysis.
