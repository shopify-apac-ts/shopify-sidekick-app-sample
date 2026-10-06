import express from "express";
import { createRequestHandler } from "@react-router/express";
import { createServer } from "node:http";

const demo = process.env.DEMO_MODE === "true";
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const host = demo ? "127.0.0.1" : "0.0.0.0";
if (!demo && (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET || !process.env.SHOPIFY_APP_URL)) {
  throw new Error("Set Shopify credentials in .env, or use pnpm run dev:demo for the local demo.");
}
if (!demo && !process.env.SHOPIFY_APP_URL.startsWith("https://")) {
  throw new Error("SHOPIFY_APP_URL must use HTTPS.");
}

const app = express();
const server = createServer(app);
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.get("/healthz", (_request, response) => response.json({ ok: true }));

// React Router rejects OPTIONS before loaders run. Handle sandbox preflights here.
app.options("/api/*", (request, response) => {
  const origin = request.get("origin");
  if (origin !== "https://extensions.shopifycdn.com") return response.sendStatus(403);
  response.set({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
  return response.sendStatus(204);
});

let vite;
if (production) {
  app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
  app.use(express.static("build/client", { maxAge: "1h" }));
  app.all("*", createRequestHandler({ build: await import("./build/server/index.js"), mode: "production" }));
} else {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: "custom" });
  app.use(vite.middlewares);
  app.all("*", createRequestHandler({ build: () => vite.ssrLoadModule("virtual:react-router/server-build"), mode: "development" }));
}

server.listen(port, host, () => console.log(`Sidekick sample: http://${demo ? host : "localhost"}:${port}/app${demo ? " (local demo)" : ""}`));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => { server.close(); void vite?.close(); });
}
