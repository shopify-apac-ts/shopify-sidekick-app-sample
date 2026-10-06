import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "@shopify/shopify-api";
import { CompanyStore } from "../app/lib/database.server";
import { seedCompanyData, dateAfter } from "../app/lib/company-data";
import { inventoryContext, recommendPlan } from "../app/lib/inventory.server";
import { SqliteSessionStorage } from "../app/lib/session-storage.server";
import type { Plan } from "../app/lib/plan";

const plan = (): Plan => ({ title: "Stock replenishment", summary: "Prioritize imminent shortages.", budget: 100000, items: [{ sku: "SKU-001", quantity: 150, reason: "Request expedited delivery." }] });
const input = (revision = 1, value = plan()) => ({ plan: value, revision, idempotencyKey: randomUUID() });

test("inventory excludes reservations, handles zero demand and includes supplier delays", () => {
  const context = inventoryContext(seedCompanyData());
  assert.equal(context.items[0].available, 24);
  assert.equal(context.items[0].shortageDay, 3);
  assert.equal(context.items[19].daysOfStock, null);
  assert.equal(context.items[19].shortageDay, null);
  assert.equal(context.items[2].earliestStandardArrival, "2026-10-16");
  assert.equal(context.items[2].requiresExpediting, true);
});

test("confirmed arrival prevents a stockout only when it arrives in time", () => {
  const data = seedCompanyData();
  assert.equal(inventoryContext(data).items[1].shortageDay, 13);
  data.inbound[0].date = dateAfter(data.referenceDate, 4);
  assert.equal(inventoryContext(data).items[1].shortageDay, 3);
  data.inbound[0].date = dateAfter(data.referenceDate, 3);
  assert.equal(inventoryContext(data).items[1].shortageDay, 13);
});

test("recommendations honor urgency, whole packs and remaining budget", () => {
  const data = seedCompanyData();
  const defaultPlan = recommendPlan(data, []);
  assert.deepEqual(defaultPlan.plan.items.map(({ sku, quantity }) => ({ sku, quantity })), [{ sku: "SKU-001", quantity: 130 }]);
  assert.equal(defaultPlan.excluded.length, 2);
  assert.deepEqual(recommendPlan(data, [], 50000).plan.items.map((item) => item.sku), ["SKU-003"]);
  assert.equal(recommendPlan(data, [], 200000).plan.items.length, 3);
  assert.throws(() => recommendPlan(data, [], NaN));
});

test("registration persists authoritative prices and replays a lost response safely", () => {
  const store = new CompanyStore(":memory:");
  try {
    const submission = input();
    const forged = { ...submission, plan: { ...submission.plan, items: [{ ...submission.plan.items[0], unitCost: 1, amount: 1 }] } };
    const first = store.submit("a.myshopify.com", "staff-1", forged);
    assert.equal(first.request.total, 90000);
    assert.equal(first.request.details[0].unitCost, 600);
    assert.equal(first.replayed, false);
    assert.equal(store.company("a.myshopify.com").revision, 2);
    const retried = store.submit("a.myshopify.com", "staff-1", forged);
    assert.equal(retried.replayed, true);
    assert.equal(retried.request.id, first.request.id);
    assert.equal(store.requests("a.myshopify.com").length, 1);
    assert.equal(store.history("a.myshopify.com").length, 1);
    assert.throws(() => store.submit("a.myshopify.com", "staff-1", { ...submission, plan: { ...plan(), title: "Changed" } }), /already used/);
  } finally { store.close(); }
});

test("invalid requests roll back, including duplicate SKU, budget and supplier constraints", () => {
  const store = new CompanyStore(":memory:");
  try {
    store.company("a");
    const invalid: Plan[] = [
      { ...plan(), budget: 1000 },
      { ...plan(), items: [{ ...plan().items[0], quantity: 151 }] },
      { ...plan(), items: [{ ...plan().items[0], quantity: 10 }] },
      { ...plan(), items: [{ ...plan().items[0], sku: "UNKNOWN" }] },
      { ...plan(), items: [plan().items[0], plan().items[0]] },
      { ...plan(), items: [{ ...plan().items[0], quantity: -10 }] },
      { ...plan(), items: [{ ...plan().items[0], reason: " " }] },
    ];
    for (const value of invalid) assert.throws(() => store.submit("a", "staff", input(1, value)));
    assert.equal(store.company("a").revision, 1);
    assert.equal(store.requests("a").length, 0);
    assert.equal(store.history("a").length, 0);
  } finally { store.close(); }
});

test("stale revisions and open requests cannot cause duplicate procurement", () => {
  const store = new CompanyStore(":memory:");
  try {
    store.submit("a", "staff", input());
    assert.throws(() => store.submit("a", "staff", input()), /changed/);
    assert.throws(() => store.submit("a", "staff", input(2)), /already has an open/);
    const { data } = store.company("a");
    const pending = store.requests("a");
    const context = inventoryContext(data, pending).items[0];
    assert.equal(context.pendingQuantity, 150);
    assert.equal(context.shortageDay, 3);
    assert.equal(recommendPlan(data, pending).plan.items.some((line) => line.sku === "SKU-001"), false);
  } finally { store.close(); }
});

test("tenant isolation, reset and uninstall preserve other shops and invalidate old forms", () => {
  const store = new CompanyStore(":memory:");
  try {
    store.submit("a", "staff-a", input()); store.submit("b", "staff-b", input());
    store.reset("a", "staff-a");
    assert.equal(store.requests("a").length, 0);
    assert.equal(store.requests("b").length, 1);
    assert.equal(store.company("a").revision, 3);
    assert.throws(() => store.submit("a", "staff", input(1)), /changed/);
    assert.equal(store.history("a")[0].event, "demo.reset");
    store.deleteShop("a");
    assert.equal(store.history("a").length, 0);
    assert.equal(store.requests("b").length, 1);
  } finally { store.close(); }
});

test("SQLite requests survive closing and reopening the single database file", () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-persistence-"));
  try {
    const file = join(dir, "company.sqlite");
    const store = new CompanyStore(file);
    const first = store.submit("a", "staff", input());
    store.close();
    const reopened = new CompanyStore(file);
    try { assert.equal(reopened.requests("a")[0].id, first.request.id); assert.equal(reopened.company("a").revision, 2); }
    finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SQLite session storage preserves staff identity, expiry and refresh metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-sessions-"));
  const original = process.env.DATABASE_PATH;
  const globalStore = globalThis as typeof globalThis & { companyStore?: CompanyStore };
  process.env.DATABASE_PATH = join(dir, "sessions.sqlite");
  try {
    const storage = new SqliteSessionStorage();
    const session = new Session({ id: "online_a_42", shop: "a.myshopify.com", state: "state", isOnline: true });
    session.accessToken = "test-token";
    session.expires = new Date("2026-10-07T00:00:00Z");
    session.refreshToken = "test-refresh";
    session.refreshTokenExpires = new Date("2026-11-06T00:00:00Z");
    session.onlineAccessInfo = { expires_in: 86400, associated_user_scope: "", associated_user: { id: 42, first_name: "Sample", last_name: "Staff", email: "staff@example.com", email_verified: true, account_owner: false, locale: "en", collaborator: false } };
    await storage.storeSession(session);
    const loaded = await storage.loadSession(session.id);
    assert.equal(loaded?.onlineAccessInfo?.associated_user.id, 42);
    assert.equal(loaded?.expires?.toISOString(), session.expires.toISOString());
    assert.equal(loaded?.refreshTokenExpires?.toISOString(), session.refreshTokenExpires.toISOString());
    assert.equal(loaded?.refreshToken, "test-refresh");
    assert.equal((await storage.findSessionsByShop(session.shop)).length, 1);
    await storage.deleteSessions([session.id]);
    assert.equal(await storage.loadSession(session.id), undefined);
  } finally {
    globalStore.companyStore?.close(); delete globalStore.companyStore;
    if (original === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
