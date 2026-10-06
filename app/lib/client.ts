export async function fetchJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const content = await response.json().catch(() => ({ error: `Request failed (${response.status}).` }));
  if (!response.ok) throw new Error(content.error || `Request failed (${response.status}).`);
  return content as T;
}
