/**
 * Project and deliverable metadata in the hub's SQLite file (node:sqlite, same file as the
 * usage store). File bytes live on disk (deliverables.ts); this table is the source of truth
 * for what exists and for the storage quota.
 */
import { DatabaseSync } from "node:sqlite";
import { Deliverable, Project, type ProjectSummary } from "@b-net/core";

export class ProjectStore {
  private readonly db: DatabaseSync;

  /** path ":memory:" for tests. */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS deliverables (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        created_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        json TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS deliverables_project ON deliverables(project_id, created_at);
    `);
  }

  /** False when the id is taken. */
  createProject(p: Project): boolean {
    const r = this.db.prepare("INSERT OR IGNORE INTO projects (id, json) VALUES (?, ?)").run(p.id, JSON.stringify(Project.parse(p)));
    return Number(r.changes) === 1;
  }

  getProject(id: string): ProjectSummary | null {
    return this.summaries(id)[0] ?? null;
  }

  listProjects(): ProjectSummary[] {
    return this.summaries(null);
  }

  private summaries(id: string | null): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.json AS json, COUNT(d.id) AS n, COALESCE(SUM(d.size_bytes), 0) AS bytes, MAX(d.created_at) AS last
         FROM projects p LEFT JOIN deliverables d ON d.project_id = p.id
         WHERE (? IS NULL OR p.id = ?) GROUP BY p.id ORDER BY p.id`,
      )
      .all(id, id) as { json: string; n: number; bytes: number; last: string | null }[];
    return rows.map((r) => ({
      ...Project.parse(JSON.parse(r.json)),
      deliverableCount: Number(r.n),
      totalBytes: Number(r.bytes),
      lastDeliverableAt: r.last,
    }));
  }

  addDeliverable(d: Deliverable): void {
    const v = Deliverable.parse(d);
    this.db
      .prepare("INSERT INTO deliverables (id, project_id, created_at, size_bytes, json) VALUES (?, ?, ?, ?, ?)")
      .run(v.id, v.projectId, v.createdAt, v.sizeBytes, JSON.stringify(v));
  }

  /** Newest first. */
  listDeliverables(projectId: string): Deliverable[] {
    const rows = this.db
      .prepare("SELECT json FROM deliverables WHERE project_id = ? ORDER BY created_at DESC, id")
      .all(projectId) as { json: string }[];
    return rows.map((r) => Deliverable.parse(JSON.parse(r.json)));
  }

  getDeliverable(projectId: string, id: string): Deliverable | null {
    const row = this.db.prepare("SELECT json FROM deliverables WHERE project_id = ? AND id = ?").get(projectId, id) as { json: string } | undefined;
    return row ? Deliverable.parse(JSON.parse(row.json)) : null;
  }

  totalBytes(): number {
    return Number((this.db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM deliverables").get() as { n: number }).n);
  }

  close(): void {
    this.db.close();
  }
}
