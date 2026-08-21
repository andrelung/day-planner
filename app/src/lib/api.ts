export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
  ) {
    super(message);
  }
}

/// Every request here goes through `cache: 'no-store'` plus (for GETs) a
/// cache-busting timestamp query param — the same belt-and-suspenders pair
/// already proven against /api/version's staleness bug (see
/// store.svelte's checkForUpdate). An iOS standalone PWA is known to serve
/// a GET response straight from WKWebView's in-memory cache with no real
/// network round-trip when nothing tells it not to, which is exactly how a
/// task deleted in Asana could still show its card after backgrounding the
/// app to delete it and coming back: refreshTasks()'s GET /api/tasks would
/// silently return the same pre-deletion snapshot. `cache: 'no-store'` is
/// the standards-compliant fix; the timestamp param is a fallback that
/// still works even if that option itself gets ignored, since a cache
/// lookup keyed on the full URL can't have this exact URL cached already.
function bustCache(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}_=${Date.now()}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const res = await fetch(method === 'GET' ? bustCache(path) : path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  let body: any = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, (body && body.error) || res.statusText, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
