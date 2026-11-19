export type ApiErrorPayload = { error?: string; ok?: boolean };

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  options: {
    invalidJsonMessage?: (status: number, responseText: string) => string;
    requireOk?: boolean;
  } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let data: T & ApiErrorPayload;
  try {
    data = JSON.parse(responseText) as T & ApiErrorPayload;
  } catch {
    const message =
      options.invalidJsonMessage?.(response.status, responseText) ??
      `Il server ha risposto con HTTP ${response.status} senza JSON.`;
    throw new Error(message);
  }
  if (!response.ok || (options.requireOk && data.ok !== true))
    throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function postRequest(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function postJsonAllowError<T>(
  url: string,
  body: unknown,
): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return { response, data: JSON.parse(text) as T };
  } catch {
    throw Object.assign(
      new Error(`HTTP ${response.status}: risposta non JSON`),
      { retryable: response.status === 429 || response.status >= 500 },
    );
  }
}
