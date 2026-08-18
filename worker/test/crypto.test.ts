import { describe, expect, it } from "vitest";
import {
  generateDeviceToken,
  hashToken,
  safeEqual,
  signSession,
  verifySession,
} from "../src/utils/crypto";

describe("crypto helpers", () => {
  it("generates ccs_ prefixed tokens and hashes them", async () => {
    const token = generateDeviceToken();
    expect(token.startsWith("ccs_")).toBe(true);
    expect(token.length).toBeGreaterThan(10);
    const hash = await hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(token)).toBe(hash);
  });

  it("signs and verifies a session with the correct secret", async () => {
    const value = await signSession("secret");
    const ok = await verifySession("secret", `session=${value}`);
    expect(ok).not.toBeNull();
    expect(ok?.admin).toBe(true);
  });

  it("rejects sessions signed with the wrong secret", async () => {
    const value = await signSession("a");
    const ok = await verifySession("b", `session=${value}`);
    expect(ok).toBeNull();
  });

  it("safeEqual is t", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("ab", "abc")).toBe(false);
  });
});
