// The headless extension runs in Shopify's sandbox, not in the app server.
declare const shopify: {
  tools: { register(name: string, handler: (input: Record<string, unknown>) => Promise<unknown>): () => void };
};

async function read(url: string) {
  // Relative requests use Shopify's app-authenticated fetch in the sandbox.
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok) return { ok: false, error: result.error || `Request failed (${response.status}).` };
  return result;
}

export default function companyData() {
  shopify.tools.register("get_company_inventory", async () => read("/api/inventory"));
  shopify.tools.register("get_replenishment_plan", async ({ budget }) => read(budget === undefined ? "/api/plan" : `/api/plan?budget=${encodeURIComponent(String(budget))}`));
  shopify.tools.register("get_replenishment_requests", async ({ id, offset }) => read(id === undefined ? "/api/requests" : `/api/requests?id=${encodeURIComponent(String(id))}&offset=${encodeURIComponent(String(offset ?? 0))}`));
}
