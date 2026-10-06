import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useRouteError } from "react-router";
import "./styles.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="icon" href="/favicon.svg" type="image/svg+xml" /><Meta /><Links /><title>Company Replenishment</title></head>
    <body>{children}<ScrollRestoration /><Scripts /></body></html>;
}
export default function Root() { return <Outlet />; }
export function ErrorBoundary() {
  const error = useRouteError();
  return <main className="error-page"><h1>{isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "Unable to load the app"}</h1>
    <p>{isRouteErrorResponse(error) ? String(error.data) : "Please reload and try again."}</p><a href="/app">Reload app</a></main>;
}
