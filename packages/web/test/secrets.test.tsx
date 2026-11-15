import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { snapshotFixture } from "@bixku/core";
import type { HubSnapshot } from "@bixku/core";
import { SecretsView } from "../src/views/secrets/SecretsView.tsx";
import { NOW_MS, renderAt } from "./helpers.tsx";

const row = (id: string) => within(screen.getByTestId(`secret-row-${id}`));

/** Attributes the view is allowed to put on any element (no value-carrying ones). */
const ALLOWED_DATA_ATTRS = new Set(["data-testid", "data-status"]);
const FORBIDDEN_ATTRS = ["value", "defaultvalue", "href", "download", "contenteditable", "draggable", "onclick"];

describe("SecretsView", () => {
  it("shows all 8 secrets grouped by kind", () => {
    renderAt(<SecretsView snapshot={snapshotFixture} />);
    expect(screen.getAllByTestId(/^secret-row-/)).toHaveLength(8);
    expect(within(screen.getByTestId("secrets-group-oauth-token")).getAllByTestId(/^secret-row-/)).toHaveLength(3);
    expect(within(screen.getByTestId("secrets-group-api-key")).getAllByTestId(/^secret-row-/)).toHaveLength(2);
    expect(within(screen.getByTestId("secrets-group-client-key")).getAllByTestId(/^secret-row-/)).toHaveLength(1);
    expect(within(screen.getByTestId("secrets-group-master-key")).getAllByTestId(/^secret-row-/)).toHaveLength(1);
    expect(within(screen.getByTestId("secrets-group-service-password")).getAllByTestId(/^secret-row-/)).toHaveLength(1);
    expect(screen.queryByTestId("secrets-group-service-token")).toBeNull(); // empty groups are not rendered
  });

  it("renders metadata: provider/account, storage, machine, fingerprint and times", () => {
    renderAt(<SecretsView snapshot={snapshotFixture} />);
    const r = row("sec-anthropic-max-1");
    expect(r.getByText("Claude Max · personal")).toBeTruthy();
    expect(r.getByText("anthropic")).toBeTruthy();
    expect(r.getByText("anthropic-max-1")).toBeTruthy();
    expect(r.getByText("archivo cifrado")).toBeTruthy();
    expect(r.getByText("bixku-homelab")).toBeTruthy();
    expect(r.getByText("3fa9c1d2").tagName).toBe("CODE");
    expect(r.getByText("hace 20d 0h")).toBeTruthy(); // created
    expect(r.getByText("hace 7h 0m")).toBeTruthy(); // rotated
    expect(r.getByText("expira en 7h 0m")).toBeTruthy();
    expect(r.getByText("hace <1m")).toBeTruthy(); // last used
    expect(row("sec-master").getByText("systemd-creds")).toBeTruthy();
    expect(row("sec-beszel-ro").getByText("variable de entorno")).toBeTruthy();
    expect(row("sec-anthropic-api-1").getByText("sin vencimiento")).toBeTruthy();
    expect(row("sec-anthropic-api-1").getByText("nunca")).toBeTruthy(); // never rotated
  });

  it("shows 'expiring' for sec-anthropic-max-2 and the other statuses", () => {
    renderAt(<SecretsView snapshot={snapshotFixture} />);
    const r = row("sec-anthropic-max-2");
    expect(r.getByText("expiring")).toBeTruthy();
    expect(r.getByText("expira en 30m")).toBeTruthy();
    expect(screen.getByTestId("secret-row-sec-anthropic-max-2").getAttribute("data-status")).toBe("expiring");
    expect(row("sec-openrouter-1").getByText("unknown")).toBeTruthy();
    expect(row("sec-master").getByText("ok")).toBeTruthy();
    const sum = within(screen.getByTestId("secrets-summary"));
    expect(sum.getByText("expiring").nextSibling?.textContent).toBe("1");
    expect(sum.getByText("ok").nextSibling?.textContent).toBe("6");
  });

  it("states prominently that values are never sent to the UI", () => {
    renderAt(<SecretsView snapshot={snapshotFixture} />);
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/Los valores nunca se envían a la UI/);
    expect(note.textContent).toMatch(/solo metadatos|únicamente metadatos/i);
  });

  it("has NO input, reveal, copy or download controls", () => {
    const { container } = renderAt(<SecretsView snapshot={snapshotFixture} />);
    expect(container.querySelectorAll("input, textarea, select, button, form, a, [role=button], [contenteditable]")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /reveal|show|mostrar|ver|copy|copiar|download|descargar|eye/i })).toBeNull();
    expect(screen.queryByText(/^(reveal|show|mostrar|revelar|copy|copiar|download|descargar)$/i)).toBeNull();
  });

  it("renders no element attribute beyond the allow-list (no value / data-* carrying anything else)", () => {
    const { container } = renderAt(<SecretsView snapshot={snapshotFixture} />);
    const all = [container, ...Array.from(container.querySelectorAll("*"))];
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        expect(FORBIDDEN_ATTRS, `${el.tagName}[${name}]`).not.toContain(name);
        if (name.startsWith("data-")) expect(ALLOWED_DATA_ATTRS.has(name), `${el.tagName}[${name}]`).toBe(true);
        // allowed data attrs must be derived from ids / enum statuses, never from free-form values
        if (name === "data-testid") expect(attr.value).toMatch(/^[a-z0-9-]+$/);
        if (name === "data-status") expect(["ok", "expiring", "expired", "invalid", "unknown"]).toContain(attr.value);
      }
    }
  });

  it("renders only SecretMeta fields: injected extra properties never reach the DOM", () => {
    const poisoned = "sk-ant-oat01-FAKE-0000000000-not-a-real-token-for-tests-only";
    const secrets = snapshotFixture.secrets.map((s) => ({ ...s, value: poisoned, token: poisoned, secret: poisoned, plaintext: poisoned })) as unknown as HubSnapshot["secrets"];
    const { container } = renderAt(<SecretsView snapshot={{ ...snapshotFixture, secrets }} />);
    const html = container.innerHTML;
    expect(html).not.toContain("THIS-MUST-NEVER-RENDER");
    expect(html).not.toMatch(/sk-[a-z]+-/i);
    // the only hex-ish blobs on screen are the 8-char fingerprints
    const leaves = Array.from(container.querySelectorAll("*")).filter((el) => el.children.length === 0);
    const hexRuns = leaves.flatMap((el) => el.textContent?.match(/\b[0-9a-f]{8,}\b/g) ?? []);
    expect(hexRuns.sort()).toEqual(snapshotFixture.secrets.map((s) => s.fingerprint).sort());
  });

  it("never renders more than 8 hex chars of a fingerprint, even from a malformed payload", () => {
    const bad = { ...snapshotFixture.secrets[0]!, fingerprint: "3fa9c1d2deadbeefcafe" };
    renderAt(<SecretsView snapshot={{ ...snapshotFixture, secrets: [bad] }} />);
    expect(screen.queryByText(/deadbeef/)).toBeNull();
  });

  it("flags upstream credentials stored outside the hub machine", () => {
    const moved = snapshotFixture.secrets.map((s) => (s.id === "sec-openai-pro-1" ? { ...s, machineId: "bixku-vps" } : s));
    renderAt(<SecretsView snapshot={{ ...snapshotFixture, secrets: moved }} />);
    expect(row("sec-openai-pro-1").getByText("fuera del hub")).toBeTruthy();
    expect(row("sec-anthropic-max-1").queryByText("fuera del hub")).toBeNull();
  });

  it("marks past expiry and shows empty state without secrets", () => {
    const expired = snapshotFixture.secrets.map((s) => (s.id === "sec-anthropic-max-2" ? { ...s, status: "expired" as const } : s));
    const { unmount } = renderAt(<SecretsView snapshot={{ ...snapshotFixture, secrets: expired }} />, NOW_MS + 60 * 60_000);
    expect(row("sec-anthropic-max-2").getByText("expired")).toBeTruthy();
    expect(row("sec-anthropic-max-2").getByText(/venció hace 30m/)).toBeTruthy();
    unmount();
    renderAt(<SecretsView snapshot={{ ...snapshotFixture, secrets: [] }} />);
    expect(screen.getByTestId("secrets-empty")).toBeTruthy();
    expect(screen.getByTestId("secrets-note")).toBeTruthy();
  });
});
