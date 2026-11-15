import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, redact, redactString } from "../src/redact.ts";

describe("redactor", () => {
  it("masks sensitive keys at any depth, keeps token COUNTS", () => {
    const out = redact({
      headers: { Authorization: "Bearer dummy-abcdef", "x-api-key": "dummy", Cookie: "a=b", "content-type": "application/json" },
      oauth: { access_token: "dummy", refresh_token: "dummy", clientSecret: "dummy" },
      password: "dummy",
      usage: { inputTokens: 10, outputTokens: 5, max_tokens: 100 },
      list: [{ apiKey: "dummy" }],
    }) as Record<string, any>;
    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.headers["x-api-key"]).toBe(REDACTED);
    expect(out.headers.Cookie).toBe(REDACTED);
    expect(out.headers["content-type"]).toBe("application/json");
    expect(out.oauth).toEqual({ access_token: REDACTED, refresh_token: REDACTED, clientSecret: REDACTED });
    expect(out.password).toBe(REDACTED);
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5, max_tokens: 100 });
    expect(out.list[0].apiKey).toBe(REDACTED);
  });

  it("masks key patterns inside free text and errors", () => {
    const s = redactString("failed with sk-ant-dummy0123456789 and Bearer dummyTokenValue123 at https://x.invalid/?key=dummyvalue&x=1");
    expect(s).not.toMatch(/dummy0123456789|dummyTokenValue123|dummyvalue/);
    expect(s).toContain("x=1");
    const e = redact(new Error("upstream said sk-proj-dummyabcdef")) as { message: string };
    expect(e.message).not.toContain("dummyabcdef");
    expect(redactString("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkdW1teSJ9.ZHVtbXlzaWduYXR1cmU")).toBe(REDACTED);
  });

  it("Headers objects are redacted", () => {
    expect(redact(new Headers({ authorization: "Bearer dummy123456", accept: "x" }))).toEqual({ authorization: REDACTED, accept: "x" });
  });

  it("logger output never contains the secret", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), () => 0);
    log.log("error", "upstream rejected sk-dummy-1234567890", { headers: { "x-api-key": "sk-dummy-1234567890" }, err: new Error("token sk-dummy-1234567890 invalid") });
    expect(lines.join()).not.toContain("1234567890");
    expect(JSON.parse(lines[0]!).level).toBe("error");
  });
});
