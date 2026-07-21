/**
 * COMPATIBILITY SHIM — router logic moved to clarityburst-plugin.
 * Re-exports (including the default configManager) from
 * clarityburst-plugin/src/config.ts. Remove once call sites import the
 * plugin directly (hook-registration stage).
 */
export * from "../../clarityburst-plugin/src/config.js";
export { default } from "../../clarityburst-plugin/src/config.js";
