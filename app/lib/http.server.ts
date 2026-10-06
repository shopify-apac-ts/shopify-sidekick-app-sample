import { ZodError } from "zod";
import { BusinessError } from "./plan";
import type { AuthContext } from "./auth.server";

export function json(context: AuthContext, value: unknown, status = 200) {
  return context.cors(Response.json(value, { status, headers: { "Cache-Control": "no-store" } }));
}
export function jsonError(context: AuthContext, error: unknown) {
  if (error instanceof Response) throw error;
  if (error instanceof ZodError) return json(context, { error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, 422);
  if (error instanceof BusinessError) return json(context, { error: error.message }, error.status);
  if (error instanceof SyntaxError) return json(context, { error: "Invalid JSON body." }, 400);
  console.error(error);
  return json(context, { error: "Unable to process the request. Please try again." }, 500);
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Response("Expected application/json", { status: 415 });
  const body = await request.text();
  if (body.length > 50000) throw new Response("Request too large", { status: 413 });
  return JSON.parse(body) as unknown;
}
