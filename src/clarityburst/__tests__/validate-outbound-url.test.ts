import { describe, it, expect } from "vitest";
import { validateOutboundUrl } from "../network-io-gating.js";

describe("validateOutboundUrl", () => {
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "https://user:pass@api.ollama.com/",
    "https://user@api.ollama.com/",
    "not a url at all",
  ])("returns a non-null rejection reason for %s", (url) => {
    expect(validateOutboundUrl(url)).not.toBeNull();
  });

  it.each([
    "https://api.ollama.com/",
    "http://localhost:11434/api/tags",
  ])("returns null for %s", (url) => {
    expect(validateOutboundUrl(url)).toBeNull();
  });
});
