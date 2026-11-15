import { describe, expect, it } from "vitest";
import { ClientAuth, generateClientKey, hashClientKey, presentedKey } from "../src/clients.ts";
import { globMatch } from "../src/util.ts";
import { baseConfig, CLIENT_KEY, DUMMY_PEPPER, LIMITED_KEY, T0 } from "./helpers.ts";

describe("client keys", () => {
  it("hash is HMAC-SHA256 with pepper (64 hex), key-dependent and pepper-dependent", () => {
    const h = hashClientKey("bxk-dummy", DUMMY_PEPPER);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClientKey("bxk-dummy", DUMMY_PEPPER + "x")).not.toBe(h);
    expect(hashClientKey("bxk-dummy2", DUMMY_PEPPER)).not.toBe(h);
  });

  it("authenticates by hash and tracks lastUsedAt", () => {
    const auth = new ClientAuth(baseConfig().clients, DUMMY_PEPPER);
    expect(auth.authenticate(CLIENT_KEY, T0)!.id).toBe("t3-test");
    expect(auth.authenticate(LIMITED_KEY, T0)!.id).toBe("bot-test");
    expect(auth.authenticate("bxk-unknown", T0)).toBeNull();
    expect(auth.authenticate(null, T0)).toBeNull();
    expect(auth.views().find((v) => v.id === "t3-test")!.lastUsedAt).toBe(new Date(T0).toISOString());
    expect(JSON.stringify(auth.views())).not.toMatch(/keyHash|[0-9a-f]{64}/);
  });

  it("rejects a short pepper", () => {
    expect(() => new ClientAuth([], "short")).toThrow();
  });

  it("reads Bearer or x-api-key", () => {
    expect(presentedKey(new Request("http://x", { headers: { authorization: "Bearer abc" } }))).toBe("abc");
    expect(presentedKey(new Request("http://x", { headers: { "x-api-key": "def" } }))).toBe("def");
    expect(presentedKey(new Request("http://x"))).toBeNull();
  });

  it("generated keys are random and prefixed", () => {
    const a = generateClientKey();
    expect(a).toMatch(/^bxk-[A-Za-z0-9_-]{32}$/);
    expect(generateClientKey()).not.toBe(a);
  });
});

describe("allowedModels globs", () => {
  it("matches *, ? and literals; empty list allows all", () => {
    expect(globMatch("claude-sonnet-*", "claude-sonnet-5-5")).toBe(true);
    expect(globMatch("claude-sonnet-*", "claude-opus-5-5")).toBe(false);
    expect(globMatch("gpt-5?", "gpt-5o")).toBe(true);
    expect(globMatch("gpt-5.1", "gpt-5x1")).toBe(false); // dot is literal
    expect(ClientAuth.allows({ allowedModels: [] }, "anything")).toBe(true);
    expect(ClientAuth.allows({ allowedModels: ["a", "claude-*"] }, "claude-x")).toBe(true);
  });
});
