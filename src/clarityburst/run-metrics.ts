/**
 * COMPATIBILITY SHIM — router logic moved to clarityburst-plugin.
 * Re-exports from clarityburst-plugin/src/run-metrics.ts so existing fork call
 * sites keep compiling. Remove once call sites import the plugin directly
 * (hook-registration stage).
 */
export * from "../../clarityburst-plugin/src/run-metrics.js";
