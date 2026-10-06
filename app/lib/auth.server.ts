import shopify, { demoMode } from "../shopify.server";

export type AuthContext = {
  shop: string; actor: string; demo: boolean;
  cors: (response: Response) => Response;
};

export function assertSameOrigin(request: Request) {
  const expected = demoMode ? new URL(request.url).origin : new URL(process.env.SHOPIFY_APP_URL!).origin;
  if (request.headers.get("origin") !== expected) throw new Response("Forbidden origin", { status: 403 });
}

export async function authenticateRequest(request: Request, writing = false): Promise<AuthContext> {
  if (writing) assertSameOrigin(request);
  if (demoMode) {
    const hostname = new URL(request.url).hostname;
    if (hostname !== "127.0.0.1" && hostname !== "localhost") throw new Response("Local demo only", { status: 403 });
    return { shop: "local-demo.myshopify.com", actor: "local-demo-user", demo: true, cors: (response) => response };
  }
  const context = await shopify!.authenticate.admin(request);
  return {
    shop: context.session.shop,
    actor: String(context.session.onlineAccessInfo?.associated_user.id || context.session.id),
    demo: false, cors: context.cors,
  };
}
