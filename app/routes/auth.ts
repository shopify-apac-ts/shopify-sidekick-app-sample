import { redirect, type LoaderFunctionArgs } from "react-router";
import shopify, { demoMode } from "../shopify.server";
export async function loader({ request }: LoaderFunctionArgs) {
  if (demoMode) return redirect("/app");
  await shopify!.authenticate.admin(request);
  return null;
}
