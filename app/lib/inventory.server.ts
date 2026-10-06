import { BusinessError, type Plan } from "./plan";
import { dateAfter, type CompanyData } from "./company-data";

export type OpenRequest = { plan: Plan };

export function inventoryContext(data: CompanyData, openRequests: OpenRequest[] = []) {
  const items = data.products.map((product) => {
    const supplier = data.suppliers.find((candidate) => candidate.id === product.supplierId)!;
    const available = product.stock.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0);
    const sales = data.sales.filter((sale) => sale.sku === product.sku && sale.date < data.referenceDate && sale.date >= dateAfter(data.referenceDate, -30));
    const dailySales = sales.reduce((sum, sale) => sum + sale.quantity, 0) / 30;
    const inbound = data.inbound.filter((shipment) => shipment.sku === product.sku && shipment.date > data.referenceDate);
    const leadDays = supplier.leadDays + supplier.delayDays;
    let balance = available;
    let shortageDay: number | null = null;
    // Assume confirmed arrivals are available at the start of their arrival day.
    for (let day = 1; day <= 60; day++) {
      const date = dateAfter(data.referenceDate, day);
      balance += inbound.filter((shipment) => shipment.date === date).reduce((sum, shipment) => sum + shipment.quantity, 0);
      balance -= dailySales;
      if (balance <= 0 && dailySales > 0) { shortageDay = day; break; }
    }
    const pendingQuantity = openRequests.flatMap((request) => request.plan.items)
      .filter((item) => item.sku === product.sku).reduce((sum, item) => sum + item.quantity, 0);
    const targetDate = dateAfter(data.referenceDate, leadDays + data.rules.targetDays);
    const confirmedQuantity = inbound.filter((shipment) => shipment.date <= targetDate).reduce((sum, shipment) => sum + shipment.quantity, 0);
    const gap = Math.max(0, Math.ceil(dailySales * (leadDays + data.rules.targetDays) - available - confirmedQuantity - pendingQuantity));
    const recommendedQuantity = gap > 0 ? Math.ceil(Math.max(gap, supplier.minimumOrder) / supplier.packSize) * supplier.packSize : 0;
    return {
      ...product, supplier, available, dailySales, inbound, pendingQuantity,
      daysOfStock: dailySales > 0 ? Math.round(available / dailySales * 10) / 10 : null,
      shortageDay, shortageDate: shortageDay === null ? null : dateAfter(data.referenceDate, shortageDay),
      risk: shortageDay !== null && shortageDay <= 7 ? "urgent" : shortageDay !== null && shortageDay <= leadDays + data.rules.safetyDays ? "watch" : "healthy",
      earliestStandardArrival: dateAfter(data.referenceDate, leadDays),
      requiresExpediting: shortageDay !== null && shortageDay < leadDays,
      recommendedQuantity,
      estimatedCost: recommendedQuantity * product.unitCost,
    };
  });
  return { referenceDate: data.referenceDate, currency: "JPY", rules: data.rules, items };
}

export function recommendPlan(data: CompanyData, requests: OpenRequest[], budget = data.rules.defaultBudget) {
  if (!Number.isInteger(budget) || budget < 1 || budget > data.rules.maximumBudget) throw new BusinessError(`Budget must be between 1 and ${data.rules.maximumBudget} JPY.`);
  const candidates = inventoryContext(data, requests).items.filter((item) => item.risk !== "healthy" && item.recommendedQuantity > 0 && item.pendingQuantity === 0)
    .sort((left, right) => (left.shortageDay ?? 99) - (right.shortageDay ?? 99) || left.sku.localeCompare(right.sku));
  let remaining = budget;
  const excluded: { sku: string; reason: string }[] = [];
  const items: Plan["items"] = [];
  for (const item of candidates) {
    if (item.estimatedCost > remaining) {
      excluded.push({ sku: item.sku, reason: `Full replenishment costs ${item.estimatedCost} JPY; remaining budget is ${remaining} JPY.` });
      continue;
    }
    remaining -= item.estimatedCost;
    items.push({ sku: item.sku, quantity: item.recommendedQuantity, reason: `${item.name}: projected shortage on ${item.shortageDate}; ${item.available} available, ${item.dailySales} units/day.${item.requiresExpediting ? " Standard delivery arrives too late; request expedited delivery." : ""}` });
  }
  return { plan: { title: data.plan.title, summary: "Prioritize projected stockouts using 30-day sales, dated inbound shipments and supplier constraints.", budget, items }, excluded };
}

export function validatePlan(plan: Plan, data: CompanyData, requests: OpenRequest[]) {
  if (plan.budget > data.rules.maximumBudget) throw new BusinessError("Budget exceeds the company purchasing limit.");
  const context = inventoryContext(data, requests);
  const seen = new Set<string>();
  const details = plan.items.map((line) => {
    if (seen.has(line.sku)) throw new BusinessError(`Duplicate SKU: ${line.sku}.`);
    seen.add(line.sku);
    const item = context.items.find((candidate) => candidate.sku === line.sku);
    if (!item) throw new BusinessError(`Unknown SKU: ${line.sku}.`);
    if (line.quantity < item.supplier.minimumOrder || line.quantity % item.supplier.packSize !== 0) {
      throw new BusinessError(`${line.sku}: minimum ${item.supplier.minimumOrder} units, in packs of ${item.supplier.packSize}.`);
    }
    if (item.pendingQuantity > 0) throw new BusinessError(`${line.sku} already has an open replenishment request. Review it before creating another.`, 409);
    return { ...line, productName: item.name, supplierName: item.supplier.name, unitCost: item.unitCost, amount: line.quantity * item.unitCost, earliestStandardArrival: item.earliestStandardArrival, requiresExpediting: item.requiresExpediting };
  });
  const total = details.reduce((sum, item) => sum + item.amount, 0);
  if (total > plan.budget) throw new BusinessError(`Total ${total} JPY exceeds the plan budget of ${plan.budget} JPY.`);
  return { total, currency: "JPY", details };
}
