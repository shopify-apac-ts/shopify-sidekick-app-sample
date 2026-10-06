import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("app", "routes/app.tsx", [
    index("routes/inventory.tsx"),
    route("plan", "routes/plan.tsx"),
    route("requests", "routes/requests.tsx"),
  ]),
  route("api/:resource", "routes/api.ts"),
  route("auth/*", "routes/auth.ts"),
  route("webhooks/app/uninstalled", "routes/uninstalled.ts"),
] satisfies RouteConfig;
