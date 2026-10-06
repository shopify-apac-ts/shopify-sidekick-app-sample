import "@shopify/shopify-app-react-router/adapters/node";
import { shopifyApp, AppDistribution, ApiVersion } from "@shopify/shopify-app-react-router/server";
import { SqliteSessionStorage } from "./lib/session-storage.server";

export const demoMode = process.env.DEMO_MODE === "true";
const shopify = demoMode ? undefined : shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: (process.env.SHOPIFY_API_VERSION || "2026-10") as ApiVersion,
  appUrl: process.env.SHOPIFY_APP_URL!,
  scopes: process.env.SCOPES?.split(",").filter(Boolean) || [],
  authPathPrefix: "/auth",
  distribution: AppDistribution.AppStore,
  sessionStorage: new SqliteSessionStorage(),
  useOnlineTokens: true,
  future: { expiringOfflineAccessTokens: true },
});
export default shopify;
