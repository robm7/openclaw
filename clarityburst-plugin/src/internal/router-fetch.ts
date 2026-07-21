/**
 * Router self-call fetch.
 *
 * The router client's own HTTP call to the ClarityBurst router service is the
 * one outbound request that must NOT be routed through the NETWORK_IO gate:
 * gating it would recurse (the gate itself consults the router). The fork's
 * network-io-gating.ts encoded this with an `isSelfCall` flag; in the plugin
 * split, the routing half (src/gates/network-io-gate.ts) performs no I/O, and
 * this module is the explicit, auditable self-call escape hatch used ONLY by
 * router-client.ts.
 *
 * Covered by the fork tripwire: router_self_call.network_io_gate.tripwire.test.ts.
 */

export async function routerSelfCallFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}
