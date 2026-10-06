import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { seedCompanyData, type CompanyData } from "./company-data";
import { BusinessError, submissionSchema, type Submission } from "./plan";
import { validatePlan } from "./inventory.server";

export type SavedRequest = ReturnType<typeof validatePlan> & {
  id: string; reference: string; plan: Submission["plan"]; status: "requested";
  createdAt: string; actor: string;
};
export type AuditEntry = { id: string; event: string; at: string; actor: string; details: string };

export class CompanyStore {
  readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS company (shop TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (shop TEXT NOT NULL, id TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(shop, id), UNIQUE(shop, idempotency_key));
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, shop TEXT NOT NULL, event TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, details TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, shop TEXT NOT NULL, payload TEXT NOT NULL);
    `);
  }
  company(shop: string): { data: CompanyData; revision: number } {
    this.db.prepare("INSERT OR IGNORE INTO company VALUES (?, 1, ?)").run(shop, JSON.stringify(seedCompanyData()));
    const row = this.db.prepare("SELECT revision, payload FROM company WHERE shop = ?").get(shop) as { revision: number; payload: string };
    return { data: JSON.parse(row.payload), revision: row.revision };
  }
  requests(shop: string): SavedRequest[] {
    return this.db.prepare("SELECT payload FROM requests WHERE shop = ? ORDER BY rowid DESC").all(shop)
      .map((row) => JSON.parse(row.payload as string));
  }
  history(shop: string): AuditEntry[] {
    return this.db.prepare("SELECT id, event, at, actor, details FROM audit WHERE shop = ? ORDER BY rowid DESC LIMIT 30").all(shop) as unknown as AuditEntry[];
  }
  log(shop: string, actor: string, event: string, details: string) {
    this.db.prepare("INSERT INTO audit VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), shop, event, new Date().toISOString(), actor, details);
  }
  submit(shop: string, actor: string, input: unknown): { request: SavedRequest; replayed: boolean } {
    const submission = submissionSchema.parse(input);
    const fingerprint = createHash("sha256").update(JSON.stringify({ plan: submission.plan, revision: submission.revision })).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Replay before checking revision: a lost response must be safely retryable.
      const existing = this.db.prepare("SELECT fingerprint, payload FROM requests WHERE shop = ? AND idempotency_key = ?").get(shop, submission.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new BusinessError("This submission key was already used for different content.", 409);
        this.db.exec("COMMIT");
        return { request: JSON.parse(existing.payload as string), replayed: true };
      }
      const company = this.company(shop);
      if (company.revision !== submission.revision) throw new BusinessError("Company data changed. Refresh the plan before registering it.", 409);
      const validated = validatePlan(submission.plan, company.data, this.requests(shop));
      const id = randomUUID();
      const request: SavedRequest = {
        ...validated, id, reference: `REQ-${id.slice(0, 8).toUpperCase()}`, plan: submission.plan,
        status: "requested", createdAt: new Date().toISOString(), actor,
      };
      this.db.prepare("INSERT INTO requests VALUES (?, ?, ?, ?, ?)").run(shop, id, submission.idempotencyKey, fingerprint, JSON.stringify(request));
      this.db.prepare("UPDATE company SET revision = revision + 1 WHERE shop = ?").run(shop);
      this.log(shop, actor, "request.created", `${request.reference}: ${request.plan.items.length} SKU(s), ${request.total} JPY`);
      this.db.exec("COMMIT");
      return { request, replayed: false };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  reset(shop: string, actor: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.company(shop);
      this.db.prepare("DELETE FROM requests WHERE shop = ?").run(shop);
      this.db.prepare("DELETE FROM audit WHERE shop = ?").run(shop);
      this.db.prepare("UPDATE company SET payload = ?, revision = revision + 1 WHERE shop = ?").run(JSON.stringify(seedCompanyData()), shop);
      this.log(shop, actor, "demo.reset", "Restored the fixed dummy data and cleared replenishment requests.");
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  deleteShop(shop: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of ["sessions", "requests", "audit", "company"]) this.db.prepare(`DELETE FROM ${table} WHERE shop = ?`).run(shop);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}

// Vite can reload server modules. Keep one SQLite connection per Node process.
const globalStore = globalThis as typeof globalThis & { companyStore?: CompanyStore };
export function getStore() {
  return globalStore.companyStore ??= new CompanyStore(process.env.DATABASE_PATH || "./data/company.sqlite");
}
