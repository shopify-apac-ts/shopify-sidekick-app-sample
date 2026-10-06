export type Supplier = {
  id: string; name: string; leadDays: number; delayDays: number;
  minimumOrder: number; packSize: number; note: string;
};
export type Product = {
  sku: string; name: string; supplierId: string; unitCost: number;
  stock: { warehouse: string; onHand: number; reserved: number }[];
};
export type CompanyData = {
  referenceDate: string;
  products: Product[];
  suppliers: Supplier[];
  sales: { sku: string; date: string; quantity: number }[];
  inbound: { id: string; sku: string; date: string; quantity: number; status: "confirmed" }[];
  rules: { safetyDays: number; targetDays: number; defaultBudget: number; maximumBudget: number };
  plan: { id: string; title: string };
};

export function dateAfter(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Fixed dates and deterministic sales keep every reset of the demo reproducible.
export function seedCompanyData(): CompanyData {
  const referenceDate = "2026-10-06";
  const names = ["Canvas tote", "Travel mug", "Linen shirt", "Everyday cap", "Desk mat", "Water bottle", "Notebook", "Pencil case", "Key holder", "Cotton towel", "Lunch bag", "Phone stand", "Cable organizer", "Wool socks", "Apron", "Storage pouch", "Travel pillow", "Umbrella", "Shopping basket", "Gift box"];
  const demand = [8, 4, 6, 5, 2, 3, 2, 1, 2, 3, 2, 1, 1, 2, 1, 2, 1, 1, 2, 0];
  const available = [24, 12, 18, 30, 180, 150, 140, 90, 120, 160, 110, 80, 90, 120, 90, 130, 80, 90, 120, 50];
  const products = names.map((name, index): Product => {
    const reserved = index < 4 ? 8 : 2;
    const total = available[index] + reserved;
    return {
      sku: `SKU-${String(index + 1).padStart(3, "0")}`, name,
      supplierId: index === 2 ? "S3" : index === 1 || index === 3 ? "S2" : "S1",
      unitCost: index === 0 ? 600 : index === 2 ? 300 : 400,
      stock: [
        { warehouse: "Tokyo", onHand: Math.ceil(total * 0.7), reserved },
        { warehouse: "Osaka", onHand: Math.floor(total * 0.3), reserved: 0 },
      ],
    };
  });
  return {
    referenceDate, products,
    suppliers: [
      { id: "S1", name: "North Supply", leadDays: 5, delayDays: 0, minimumOrder: 20, packSize: 10, note: "Standard delivery; expedited delivery must be confirmed by purchasing." },
      { id: "S2", name: "East Trading", leadDays: 7, delayDays: 0, minimumOrder: 10, packSize: 10, note: "Travel mugs have a confirmed inbound shipment in two days." },
      { id: "S3", name: "Linen Works", leadDays: 5, delayDays: 5, minimumOrder: 30, packSize: 10, note: "Factory maintenance adds five days to the normal lead time." },
    ],
    sales: products.flatMap((product, index) => Array.from({ length: 30 }, (_, day) => ({
      sku: product.sku, date: dateAfter(referenceDate, -30 + day), quantity: demand[index],
    }))),
    inbound: [{ id: "IN-001", sku: "SKU-002", date: dateAfter(referenceDate, 2), quantity: 40, status: "confirmed" }],
    rules: { safetyDays: 3, targetDays: 14, defaultBudget: 100000, maximumBudget: 200000 },
    plan: { id: "replenishment", title: "Warehouse replenishment plan" },
  };
}
