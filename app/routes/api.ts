import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticateRequest } from "../lib/auth.server";
import { getStore } from "../lib/database.server";
import { inventoryContext, recommendPlan, validatePlan } from "../lib/inventory.server";
import { BusinessError, planSchema } from "../lib/plan";
import { json, jsonError, readJson } from "../lib/http.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await authenticateRequest(request);
  try {
    const store = getStore();
    const { data, revision } = store.company(auth.shop);
    const requests = store.requests(auth.shop);
    const metadata = { source: "dummy-company-data", referenceDate: data.referenceDate, revision, currency: "JPY" };
    if (params.resource === "inventory") {
      const context = inventoryContext(data, requests);
      // Compact summaries keep the 20-SKU response within Sidekick's token limit.
      return json(auth, { ...metadata, rules: data.rules, suppliers: data.suppliers,
        items: context.items.map((item) => ({ sku: item.sku, name: item.name, available: item.available,
          dailySales: item.dailySales, inbound: item.inbound.map(({ date, quantity }) => ({ date, quantity })),
          pendingQuantity: item.pendingQuantity, shortageDate: item.shortageDate, risk: item.risk,
          supplierId: item.supplierId, unitCost: item.unitCost, recommendedQuantity: item.recommendedQuantity,
          earliestStandardArrival: item.earliestStandardArrival, requiresExpediting: item.requiresExpediting })) });
    }
    if (params.resource === "plan") {
      const rawBudget = new URL(request.url).searchParams.get("budget");
      const recommendation = recommendPlan(data, requests, rawBudget === null ? undefined : Number(rawBudget));
      return json(auth, { ...metadata, ...recommendation, results: [{ type: "resource_link", uri: "gid://application/optimization-plan/replenishment",
        name: recommendation.plan.title, mimeType: "application/optimization-plan", _meta: { budget: recommendation.plan.budget, itemCount: recommendation.plan.items.length, saved: false } }] });
    }
    if (params.resource === "requests") {
      const id = new URL(request.url).searchParams.get("id");
      if (id) {
        const result = requests.find((entry) => entry.id === id || entry.reference === id);
        if (!result) throw new BusinessError("Request not found.", 404);
        const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
        if (!Number.isInteger(offset) || offset < 0 || offset > 20) throw new BusinessError("Offset must be between 0 and 20.");
        return json(auth, { ...metadata, request: { id: result.id, reference: result.reference, status: result.status, createdAt: result.createdAt, total: result.total,
          title: result.plan.title, summary: result.plan.summary.slice(0, 400),
          details: result.details.slice(offset, offset + 5).map(({ sku, quantity, amount, supplierName, earliestStandardArrival, requiresExpediting, reason }) => ({ sku, quantity, amount, supplierName, earliestStandardArrival, requiresExpediting, reason: reason.slice(0, 260) })),
          itemCount: result.details.length, nextOffset: offset + 5 < result.details.length ? offset + 5 : null, reasonsTruncatedAt: 260 } });
      }
      return json(auth, { ...metadata, count: requests.length, requests: requests.slice(0, 10).map(({ id, reference, status, createdAt, total, plan }) => ({ id, reference, status, createdAt, total, title: plan.title, itemCount: plan.items.length })), more: requests.length > 10 });
    }
    return json(auth, { error: "Unknown resource." }, 404);
  } catch (error) { return jsonError(auth, error); }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const auth = await authenticateRequest(request, true);
  try {
    if (request.method !== "POST") return json(auth, { error: "Method not allowed." }, 405);
    const input = await readJson(request);
    const store = getStore();
    if (params.resource === "requests") {
      const result = store.submit(auth.shop, auth.actor, input);
      return json(auth, result, result.replayed ? 200 : 201);
    }
    if (params.resource === "preview") {
      const plan = planSchema.parse(input);
      const { data, revision } = store.company(auth.shop);
      return json(auth, { ...validatePlan(plan, data, store.requests(auth.shop)), revision });
    }
    if (params.resource === "reset") {
      if (!(input && typeof input === "object" && "confirmation" in input && input.confirmation === "RESET")) throw new BusinessError("Reset requires confirmation.");
      store.reset(auth.shop, auth.actor);
      return json(auth, { ok: true });
    }
    return json(auth, { error: "This endpoint does not accept changes." }, 405);
  } catch (error) { return jsonError(auth, error); }
}
