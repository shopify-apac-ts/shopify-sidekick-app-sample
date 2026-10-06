import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { authenticateRequest } from "../lib/auth.server";
import { getStore } from "../lib/database.server";
import { formatYen } from "../lib/plan";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateRequest(request);
  const store = getStore();
  return { requests: store.requests(auth.shop), history: store.history(auth.shop) };
}
export default function Requests() {
  const { requests, history } = useLoaderData<typeof loader>();
  return <s-page heading="Registered replenishment requests" inlineSize="large">
    <s-button slot="primary-action" href="/app/plan" variant="primary">Prepare another plan</s-button>
    <div className="stack">
      <s-banner tone="info">Requests are saved in the sample company's data store outside Shopify. A request records a purchasing instruction; supplier acceptance and delivery are not simulated.</s-banner>
      {requests.length === 0 && <s-section heading="No requests yet"><s-paragraph>Prepare a plan, review its quantities and reasons, then register it.</s-paragraph></s-section>}
      {requests.map((request) => <s-section key={request.id} heading={`${request.reference} · ${request.plan.title}`}>
        <s-paragraph><s-badge tone="info">{request.status}</s-badge> {formatYen(request.total)} · {new Date(request.createdAt).toISOString()} · {request.actor}</s-paragraph>
        <s-paragraph>{request.plan.summary}</s-paragraph>
        <div className="table-scroll"><table><thead><tr><th>Product</th><th>Quantity</th><th>Amount</th><th>Standard arrival</th><th>Purchasing reason</th></tr></thead><tbody>{request.details.map((line) => <tr key={line.sku}><td>{line.productName}<br /><span className="muted">{line.sku} · {line.supplierName}</span></td><td>{line.quantity}</td><td>{formatYen(line.amount)}</td><td>{line.earliestStandardArrival}{line.requiresExpediting && <><br /><s-badge tone="warning">Expedite needed</s-badge></>}</td><td className="wrap">{line.reason}</td></tr>)}</tbody></table></div>
      </s-section>)}
      <s-section heading="Recent activity"><div className="table-scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Details</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id}><td>{entry.at}</td><td>{entry.event}</td><td>{entry.actor}</td><td className="wrap">{entry.details}</td></tr>)}</tbody></table></div></s-section>
    </div>
  </s-page>;
}
