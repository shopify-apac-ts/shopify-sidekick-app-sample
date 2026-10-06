import type { ActionFunctionArgs } from "react-router";
import shopify, { demoMode } from "../shopify.server";
import { getStore } from "../lib/database.server";
export async function action({ request }: ActionFunctionArgs) {
  if (demoMode) return new Response(null, { status: 404 });
  const { shop, topic } = await shopify!.authenticate.webhook(request);
  if (topic === "APP_UNINSTALLED") getStore().deleteShop(shop);
  return new Response(null, { status: 200 });
}
