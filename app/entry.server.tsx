import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { isbot } from "isbot";
import shopify from "./shopify.server";

export default function handleRequest(request: Request, status: number, headers: Headers, context: EntryContext) {
  shopify?.addDocumentResponseHeaders(request, headers);
  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const callback = isbot(request.headers.get("user-agent") || "") ? "onAllReady" : "onShellReady";
    const stream = renderToPipeableStream(<ServerRouter context={context} url={request.url} />, {
      [callback]() {
        shellRendered = true;
        const body = new PassThrough();
        headers.set("Content-Type", "text/html");
        resolve(new Response(createReadableStreamFromReadable(body), { status, headers }));
        stream.pipe(body);
      },
      onShellError: reject,
      onError(error) { status = 500; if (shellRendered) console.error(error); },
    });
    const timer = setTimeout(() => stream.abort(), 10000);
    timer.unref();
  });
}
