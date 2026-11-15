import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accountBaseUrl, accountFormat, loadConfig, parseConfig } from "../src/config.ts";
import { redactString } from "../src/redact.ts";
import { account, baseConfig } from "./helpers.ts";

const EXAMPLE = fileURLToPath(new URL("../../../config/proxy.example.json", import.meta.url));

describe("config", () => {
  it("the example config parses and applies defaults", () => {
    const cfg = loadConfig(EXAMPLE);
    expect(cfg.accounts).toHaveLength(3);
    expect(cfg.routing.strategy).toBe("round-robin");
    expect(cfg.accounts[0]!.extraHeaders).toEqual({});
    expect(cfg.accounts.find((a) => a.id === "anthropic-api-1")!.role).toBe("standby");
  });

  it("the example config contains only placeholders (no key-looking values)", () => {
    const raw = readFileSync(EXAMPLE, "utf8");
    expect(redactString(raw)).toBe(raw);
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]/);
    for (const c of loadConfig(EXAMPLE).clients) expect(c.keyHash).toMatch(/^(.)\1{63}$/);
  });

  it("minimal config gets full routing defaults", () => {
    const cfg = parseConfig({ listen: { host: "127.0.0.1", port: 1 }, secrets: { file: "a", masterKeyFile: "b" }, records: { sqlitePath: ":memory:" } });
    expect(cfg.routing.cooldown).toEqual({ backoffBaseMs: 1000, backoffMaxMs: 1_800_000, serverErrorMs: 60_000, modelNotFoundMs: 43_200_000 });
    expect(cfg.routing.sessionAffinity.enabled).toBe(false);
    expect(cfg.legacyProxy.retired).toBe(false);
  });

  it("rejects duplicate account ids and dangling route accounts", () => {
    expect(() => baseConfig({ accounts: [account("a"), account("a")] })).toThrow(/duplicate/);
    expect(() => baseConfig({ routes: [{ match: "x", provider: "anthropic", upstreamModel: null, accounts: ["ghost"] }] })).toThrow(/unknown account/);
    expect(() => baseConfig({ listen: { host: "x", port: 0 } })).toThrow(/invalid proxy config/);
  });

  it("derives format and base URL", () => {
    const cfg = baseConfig({ accounts: [account("or", { provider: "openrouter" }), account("custom", { provider: "other", baseUrl: "https://llm.example.invalid/" })] });
    expect(accountFormat(cfg.accounts[0]!)).toBe("openai");
    expect(accountBaseUrl(cfg.accounts[0]!, cfg)).toBe("https://openrouter.ai/api");
    expect(accountBaseUrl(cfg.accounts[1]!, cfg)).toBe("https://llm.example.invalid");
  });
});
