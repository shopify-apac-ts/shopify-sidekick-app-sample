import { useState } from "react";
import { useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import { authenticateRequest } from "../lib/auth.server";
import { getStore } from "../lib/database.server";
import { inventoryContext } from "../lib/inventory.server";
import { formatYen } from "../lib/plan";
import { fetchJson } from "../lib/client";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateRequest(request);
  const store = getStore();
  const company = store.company(auth.shop);
  const requests = store.requests(auth.shop);
  return { ...inventoryContext(company.data, requests), suppliers: company.data.suppliers, requestCount: requests.length };
}
export default function Inventory() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  async function reset() {
    if (!window.confirm("Restore dummy data and delete all registered replenishment requests for this shop?")) return;
    setResetting(true); setError("");
    try { await fetchJson("/api/reset", { confirmation: "RESET" }); revalidator.revalidate(); }
    catch (error) { setError((error as Error).message); }
    finally { setResetting(false); }
  }
  return <s-page heading="Company inventory" inlineSize="large">
    <s-button slot="primary-action" variant="primary" href="/app/plan">Prepare replenishment</s-button>
    <div className="stack">
      <s-banner heading="Dummy internal data" tone="info">Fixed snapshot: {data.referenceDate}. Stock, sales and suppliers belong to the sample company. Registered requests remain open and do not count as confirmed inbound shipments.</s-banner>
      {error && <s-banner tone="critical" heading="Reset failed">{error}</s-banner>}
      <div className="metrics">
        <div className="metric">Products<strong>{data.items.length}</strong></div>
        <div className="metric">Stockouts within 7 days<strong>{data.items.filter((item) => item.risk === "urgent").length}</strong></div>
        <div className="metric">Default purchasing budget<strong>{formatYen(data.rules.defaultBudget)}</strong></div>
        <div className="metric">Open requests<strong>{data.requestCount}</strong></div>
      </div>
      <s-section heading="Warehouse stock and shortage forecast">
        <div className="table-scroll"><table><thead><tr><th>Product</th><th>Available</th><th>Sales / day</th><th>Confirmed inbound</th><th>Projected stockout</th><th>Open request qty</th><th>Risk</th></tr></thead>
          <tbody>{data.items.map((item) => <tr key={item.sku}><td><strong>{item.name}</strong><br /><span className="muted">{item.sku}</span></td><td>{item.available}</td><td>{item.dailySales}</td><td>{item.inbound.map((shipment) => `${shipment.quantity} on ${shipment.date}`).join(", ") || "—"}</td><td>{item.shortageDate || "Beyond 60 days"}</td><td>{item.pendingQuantity || "—"}</td><td><s-badge tone={item.risk === "urgent" ? "critical" : item.risk === "watch" ? "warning" : "success"}>{item.risk}</s-badge></td></tr>)}</tbody>
        </table></div>
      </s-section>
      <s-section heading="Purchasing rules and suppliers">
        <s-paragraph>Stock target: {data.rules.targetDays} days. Safety buffer for risk detection: {data.rules.safetyDays} days. Maximum request budget: {formatYen(data.rules.maximumBudget)}. Available stock excludes reserved units. Daily demand is the average of the last 30 calendar days.</s-paragraph>
        <div className="table-scroll"><table><thead><tr><th>Supplier</th><th>Lead time + delay</th><th>Minimum / pack</th><th>Note</th></tr></thead><tbody>{data.suppliers.map((supplier) => <tr key={supplier.id}><td>{supplier.name}</td><td>{supplier.leadDays} + {supplier.delayDays} days</td><td>{supplier.minimumOrder} / {supplier.packSize}</td><td className="wrap">{supplier.note}</td></tr>)}</tbody></table></div>
      </s-section>
      <s-section heading="Try it with Sidekick">
        <s-paragraph>Ask Sidekick in Shopify Admin to analyze company inventory and prepare a replenishment plan. Review the form and click Register request to save it.</s-paragraph>
        <s-unordered-list><s-list-item>「社内在庫で7日以内に欠品する商品を調べて、予算10万円で補充計画を作って」</s-list-item><s-list-item>「SKU-001の数量を150にして、発注理由に至急配送が必要と追記して」</s-list-item><s-list-item>「登録済みの補充依頼を確認して」</s-list-item></s-unordered-list>
      </s-section>
      <s-section heading="Reset the sample"><s-paragraph>Restore the fixed snapshot and clear this shop's dummy requests.</s-paragraph><s-button tone="critical" loading={resetting} disabled={resetting} onClick={reset}>Reset dummy data</s-button></s-section>
    </div>
  </s-page>;
}
