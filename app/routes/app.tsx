import { Outlet, useLoaderData, useRouteError, type LoaderFunctionArgs, type HeadersFunction } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticateRequest } from "../lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateRequest(request);
  return { demo: auth.demo, apiKey: process.env.SHOPIFY_API_KEY || "" };
}
export default function App() {
  const { demo, apiKey } = useLoaderData<typeof loader>();
  const content = <>
    <nav className="app-nav" aria-label="App navigation"><a href="/app">Inventory</a><a href="/app/plan">Replenishment plan</a><a href="/app/requests">Registered requests</a></nav>
    {demo && <div className="demo-label">Local demo · Dummy company data · Sidekick is available in Shopify Admin after app installation</div>}
    <Outlet context={{ demo }} />
  </>;
  return demo ? <><script src="https://cdn.shopify.com/shopifycloud/polaris-1.js" />{content}</> : <AppProvider apiKey={apiKey} polarisUrl="https://cdn.shopify.com/shopifycloud/polaris-1.js">{content}</AppProvider>;
}
export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (args) => boundary.headers(args);
