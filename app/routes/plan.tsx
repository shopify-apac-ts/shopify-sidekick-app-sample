import { useEffect, useRef, useState } from "react";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticateRequest } from "../lib/auth.server";
import { getStore, type SavedRequest } from "../lib/database.server";
import { inventoryContext, recommendPlan } from "../lib/inventory.server";
import { BusinessError, planSchema, lineSchema, formatYen, type Plan } from "../lib/plan";
import { fetchJson } from "../lib/client";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateRequest(request);
  const planId = new URL(request.url).searchParams.get("planId");
  if (planId && !["replenishment", "gid://application/optimization-plan/replenishment"].includes(planId)) throw new Response("Unknown optimization plan", { status: 404 });
  const store = getStore();
  const { data, revision } = store.company(auth.shop);
  const requests = store.requests(auth.shop);
  return { ...recommendPlan(data, requests), ...inventoryContext(data, requests), revision, demo: auth.demo };
}
type Preview = { total: number; revision: number };
const patchSchema = planSchema.partial();
const updateSchema = lineSchema.partial().required({ sku: true });

export default function PlanEditor() {
  const data = useLoaderData<typeof loader>();
  const [plan, setPlan] = useState<Plan>(data.plan);
  const draft = useRef(plan);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const key = useRef<string>("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<SavedRequest>();
  const savedRef = useRef(false);
  const [intentOpen, setIntentOpen] = useState(false);
  const [newSku, setNewSku] = useState("");

  function change(next: Plan) {
    if (locked.current || savedRef.current) return;
    draft.current = next; setPlan(next); key.current = ""; setError(""); setNotice("");
  }
  async function stage(input: unknown) {
    if (locked.current || savedRef.current) throw new Error("The form is busy or has already been registered.");
    const next = planSchema.parse({ ...draft.current, ...patchSchema.parse(input) });
    locked.current = true; setBusy(true);
    try {
      const preview = await fetchJson<Preview>("/api/preview", next);
      if (preview.revision !== data.revision) throw new BusinessError("Company data changed. Reload the editor before continuing.");
      draft.current = next; setPlan(next); key.current = ""; setError("");
      setNotice("Sidekick staged changes. Review the form, then click Register request.");
      return { ok: true, saved: false, total: preview.total, budget: next.budget, itemCount: next.items.length, note: "Staged in the form. Awaiting merchant Register request; no replenishment request has been saved." };
    } finally { locked.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (data.demo || !window.shopify?.tools) return;
    const api = window.shopify;
    const cleanups = [
      api.tools.register("stage_replenishment_plan", async (input) => {
        try { return await stage(input); } catch (error) { setError((error as Error).message); return { ok: false, error: (error as Error).message, saved: false }; }
      }),
      api.tools.register("update_replenishment_line", async (input) => {
        try {
          const patch = updateSchema.parse(input);
          if (!draft.current.items.some((line) => line.sku === patch.sku)) throw new Error("SKU is not in the current draft. Use stage_replenishment_plan to replace the line list.");
          return await stage({ items: draft.current.items.map((line) => line.sku === patch.sku ? { ...line, ...patch } : line) });
        } catch (error) { setError((error as Error).message); return { ok: false, error: (error as Error).message, saved: false }; }
      }),
      api.tools.register("get_staged_replenishment_plan", async ({ sku }) => {
        if (sku !== undefined) {
          const item = draft.current.items.find((line) => line.sku === sku);
          return item ? { item, saved: savedRef.current } : { ok: false, error: "SKU is not in the current draft." };
        }
        return { plan: { ...draft.current, summary: draft.current.summary.slice(0, 300), items: draft.current.items.map((line) => ({ ...line, reason: line.reason.slice(0, 80) })) }, saved: savedRef.current, note: "Summary and reasons shortened for tool output. Supply sku to read a full purchasing reason." };
      }),
    ];
    // Intent input only fills a draft. Even an invocation containing a full plan cannot submit it.
    const receive = (intent: typeof api.intents.request.value) => {
      setIntentOpen(Boolean(intent));
      if (!intent || intent.type !== "application/optimization-plan") return;
      if (intent.value && !["replenishment", "gid://application/optimization-plan/replenishment"].includes(String(intent.value))) {
        setError("Unknown optimization plan."); return;
      }
      if (intent.data && Object.keys(intent.data).length) {
        try { change(planSchema.parse({ ...draft.current, ...patchSchema.parse(intent.data) })); }
        catch (error) { setError(error instanceof z.ZodError ? "Some intent fields are invalid. Complete the form before registering." : (error as Error).message); }
      }
    };
    receive(api.intents.request.value);
    cleanups.push(api.intents.request.subscribe(receive));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [data.demo, data.revision]);

  const total = plan.items.reduce((sum, line) => sum + line.quantity * (data.items.find((item) => item.sku === line.sku)?.unitCost || 0), 0);
  async function register() {
    if (locked.current || savedRef.current) return;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const validated = planSchema.parse(draft.current);
      key.current ||= crypto.randomUUID();
      const result = await fetchJson<{ request: SavedRequest }>("/api/requests", { plan: validated, revision: data.revision, idempotencyKey: key.current });
      savedRef.current = true; setSaved(result.request);
      if (!data.demo && window.shopify?.intents.request.value) {
        // Saving has succeeded even if the parent intent cannot receive the response.
        try { await window.shopify.intents.response?.ok({ requestId: result.request.id, reference: result.request.reference, total: result.request.total, status: result.request.status }); }
        catch { setNotice("Request saved. Close this window and view registered requests."); }
      }
    } catch (error) { setError(error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : (error as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  function cancel() {
    if (intentOpen && !data.demo) void window.shopify.intents.response?.closed();
    else { change(data.plan); setNotice("Draft changes discarded. Nothing was registered."); }
  }
  async function recommend() {
    if (locked.current || savedRef.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await fetchJson<{ plan: Plan; revision: number }>(`/api/plan?budget=${plan.budget}`);
      if (result.revision !== data.revision) throw new Error("Company data changed. Reload this page.");
      draft.current = result.plan; setPlan(result.plan); key.current = ""; setNotice("Rule-based draft prepared. Review quantities and reasons before registering.");
    } catch (error) { setError((error as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  function editLine(sku: string, patch: Partial<Plan["items"][number]>) {
    change({ ...draft.current, items: draft.current.items.map((line) => line.sku === sku ? { ...line, ...patch } : line) });
  }
  function addLine() {
    const item = data.items.find((item) => item.sku === newSku);
    if (!item) return;
    change({ ...draft.current, items: [...draft.current.items, { sku: item.sku, quantity: item.recommendedQuantity || item.supplier.minimumOrder, reason: "" }] });
    setNewSku("");
  }

  return <s-page heading="Replenishment plan" inlineSize="large"><div className="stack">
    <s-banner heading={saved ? "Request registered" : "Review before registration"} tone={saved ? "success" : "info"}>
      {saved ? `${saved.reference} was saved with a total of ${formatYen(saved.total)}.` : `Snapshot ${data.referenceDate}. Changes stay in this form until you click Register request.`}
    </s-banner>
    {error && <s-banner heading="Unable to continue" tone="critical">{error} <s-link href="/app/plan">Reload editor</s-link></s-banner>}
    {notice && <s-banner tone="info">{notice}</s-banner>}
    <s-section heading="Plan details">
      <div className="stack"><div className="form-grid">
        <s-text-field label="Plan title" value={plan.title} maxLength={120} disabled={busy || Boolean(saved)} onInput={(event) => change({ ...draft.current, title: event.currentTarget.value })} />
        <s-number-field label="Budget (JPY)" value={String(plan.budget)} min={1} max={data.rules.maximumBudget} step={1} disabled={busy || Boolean(saved)} onInput={(event) => change({ ...draft.current, budget: Number(event.currentTarget.value) })} />
      </div><s-text-area label="Analysis summary" value={plan.summary} maxLength={2000} disabled={busy || Boolean(saved)} onInput={(event) => change({ ...draft.current, summary: event.currentTarget.value })} />
      <div className="actions"><s-button disabled={busy || Boolean(saved)} onClick={recommend}>Recalculate draft for this budget</s-button><span className="muted">A deterministic starting point; Sidekick can revise it using the company data.</span></div></div>
    </s-section>
    <s-section heading="Replenishment lines">
      {plan.items.length === 0 && <s-paragraph>No eligible lines fit the budget. Increase the budget or add a product.</s-paragraph>}
      {plan.items.map((line) => {
        const item = data.items.find((item) => item.sku === line.sku);
        return <div className="draft-line" key={line.sku}><div className="line-grid">
          <div><strong>{item?.name || line.sku}</strong><p className="muted">{line.sku}<br />{formatYen(item?.unitCost || 0)} / unit<br />Minimum {item?.supplier.minimumOrder}, pack {item?.supplier.packSize}</p></div>
          <s-number-field label="Quantity" value={String(line.quantity)} min={1} max={10000} step={item?.supplier.packSize || 1} disabled={busy || Boolean(saved)} onInput={(event) => editLine(line.sku, { quantity: Number(event.currentTarget.value) })} />
          <s-text-area label="Purchasing reason" value={line.reason} maxLength={500} disabled={busy || Boolean(saved)} onInput={(event) => editLine(line.sku, { reason: event.currentTarget.value })} />
          <s-button disabled={busy || Boolean(saved)} onClick={() => change({ ...draft.current, items: draft.current.items.filter((candidate) => candidate.sku !== line.sku) })}>Remove</s-button>
        </div>{item?.requiresExpediting && <s-banner tone="warning">Projected stockout: {item.shortageDate}. Standard arrival: {item.earliestStandardArrival}. Purchasing must confirm an expedited delivery; registering this request does not guarantee stockout prevention.</s-banner>}</div>;
      })}
      {!saved && <div className="actions" style={{ marginTop: 20 }}><s-select label="Add a product" value={newSku} disabled={busy} onChange={(event) => setNewSku(event.currentTarget.value)}><s-option value="">Select a product</s-option>{data.items.filter((item) => item.pendingQuantity === 0 && !plan.items.some((line) => line.sku === item.sku)).map((item) => <s-option key={item.sku} value={item.sku}>{item.sku} · {item.name}</s-option>)}</s-select><s-button disabled={busy || !newSku} onClick={addLine}>Add line</s-button></div>}
    </s-section>
    {data.excluded.length > 0 && <s-section heading="Initial draft exclusions"><s-unordered-list>{data.excluded.map((entry) => <s-list-item key={entry.sku}>{entry.sku}: {entry.reason}</s-list-item>)}</s-unordered-list></s-section>}
    <s-section heading="Registration"><div className="stack"><p className="total">Estimated total: {formatYen(total)}</p>
      <s-paragraph>Budget: {formatYen(plan.budget)}. The server checks the latest data, prices, minimum orders and existing open requests at registration.</s-paragraph>
      <div className="actions">{saved ? <s-button href="/app/requests" variant="primary">View registered requests</s-button> : <><s-button variant="primary" loading={busy} disabled={busy || !plan.items.length} onClick={register}>Register request</s-button><s-button disabled={busy} onClick={cancel}>Cancel changes</s-button></>}</div></div>
    </s-section>
  </div></s-page>;
}
