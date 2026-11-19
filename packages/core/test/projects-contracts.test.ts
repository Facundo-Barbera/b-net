import { describe, expect, it } from "vitest";
import { Deliverable, DeliverableUploadQuery, HubEvent, HubRoutes, Project, ProjectInput, ProjectSummary } from "../src/index.ts";

const deliverable = {
  id: "0b6f3c1e-8a5d-4c2b-9f1e-2d3c4b5a6978",
  projectId: "fhub",
  title: "Phase 2 report",
  filename: "report.html",
  kind: "html",
  mimeType: "text/html; charset=utf-8",
  sizeBytes: 1234,
  sha256: "a".repeat(64),
  author: "fstack-vps",
  threadId: null,
  prUrl: "https://github.com/example/repo/pull/1",
  createdAt: "2026-11-17T10:00:00.000Z",
};

describe("project contracts", () => {
  it("ProjectInput fills defaults and Project validates the stored shape", () => {
    const input = ProjectInput.parse({ id: "fhub", name: "fhub" });
    expect(input).toEqual({ id: "fhub", name: "fhub", description: "", grouping: { t3ProjectTitles: [], paths: [], gitRemotes: [] }, ownerBot: null });
    expect(Project.safeParse({ ...input, createdAt: "2026-11-17T10:00:00.000Z" }).success).toBe(true);
    expect(ProjectSummary.safeParse({ ...input, createdAt: "2026-11-17T10:00:00.000Z", deliverableCount: 0, totalBytes: 0, lastDeliverableAt: null }).success).toBe(true);
  });

  it("project ids are closed slugs (no traversal, no uppercase, no dots)", () => {
    for (const id of ["../etc", "a/b", "Fhub", ".hidden", "-x", "", "a".repeat(64), "a\0b"]) {
      expect(ProjectInput.safeParse({ id, name: "x" }).success, id).toBe(false);
    }
    expect(ProjectInput.safeParse({ id: "a".repeat(63), name: "x" }).success).toBe(true);
  });

  it("ProjectInput rejects unknown fields (createdAt is set by the hub)", () => {
    expect(ProjectInput.safeParse({ id: "x", name: "x", createdAt: "2026-11-17T10:00:00.000Z" }).success).toBe(false);
  });

  it("Deliverable accepts the canonical shape and rejects out-of-list kinds and bad hashes", () => {
    expect(Deliverable.safeParse(deliverable).success).toBe(true);
    expect(Deliverable.safeParse({ ...deliverable, kind: "exe" }).success).toBe(false);
    expect(Deliverable.safeParse({ ...deliverable, sha256: "A".repeat(64) }).success).toBe(false);
    expect(Deliverable.safeParse({ ...deliverable, prUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(Deliverable.safeParse({ ...deliverable, id: "../x" }).success).toBe(false);
  });

  it("upload query is strict: author cannot be smuggled in", () => {
    expect(DeliverableUploadQuery.safeParse({ title: "x" }).success).toBe(true);
    expect(DeliverableUploadQuery.safeParse({ title: "x", author: "someone-else" }).success).toBe(false);
    expect(DeliverableUploadQuery.safeParse({ title: "   " }).success).toBe(false);
  });

  it("HubEvent discriminates the four event types", () => {
    const base = { id: "0b6f3c1e-8a5d-4c2b-9f1e-2d3c4b5a6978", at: "2026-11-17T10:00:00.000Z", projectId: "fhub", title: "t" };
    expect(HubEvent.parse({ ...base, type: "thread_completed", machineId: "m", threadId: "th" }).type).toBe("thread_completed");
    expect(HubEvent.safeParse({ ...base, type: "pending_input", machineId: "m", threadId: "th" }).success).toBe(true);
    expect(HubEvent.safeParse({ ...base, type: "blocked", machineId: "m", threadId: "th" }).success).toBe(false);
    expect(HubEvent.safeParse({ ...base, type: "manual", by: "fstack-vps", message: "hi" }).success).toBe(true);
    expect(HubEvent.safeParse({ ...base, type: "other" }).success).toBe(false);
  });

  it("routes are declared for the projects API", () => {
    expect(HubRoutes.deliverableContent).toBe("/api/v1/projects/:id/deliverables/:deliverableId/content");
  });
});
