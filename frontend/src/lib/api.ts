// Production: the browser calls the Django API directly at NEXT_PUBLIC_API_URL (CORS is enabled there).
// Development/Docker: unset, so requests go to /api on this origin and Next proxies them to Django.
export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
const BASE = `${API_ORIGIN}/api`;

/** Make a server-returned media path (e.g. /media/properties/x.jpg) loadable from the browser. */
export function mediaUrl(src: string | null | undefined): string {
  if (!src) return "";
  return /^https?:\/\//i.test(src) ? src : `${API_ORIGIN}${src}`;
}
const ACCESS_KEY = "crm.access";
const REFRESH_KEY = "crm.refresh";

type Params = Record<string, string | number | boolean | null | undefined>;

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, data: unknown) {
    super(extractMessage(data) || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }

  /** DRF field errors → { field: "message" } (first message per field). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.data && typeof this.data === "object" && !Array.isArray(this.data)) {
      for (const [key, value] of Object.entries(this.data as Record<string, unknown>)) {
        if (key === "detail" || key === "code" || key === "conflicts") continue;
        const first = Array.isArray(value) ? value[0] : value;
        if (typeof first === "string") out[key] = first;
      }
    }
    return out;
  }
}

function extractMessage(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(extractMessage).filter(Boolean).join(" ");
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    const parts = Object.entries(obj)
      .map(([k, v]) => {
        const msg = extractMessage(v);
        return msg ? (k === "non_field_errors" ? msg : `${k.replace(/_/g, " ")}: ${msg}`) : "";
      })
      .filter(Boolean);
    return parts.join(" · ");
  }
  return "";
}

// ---- token storage -------------------------------------------------------------------------------
export const tokens = {
  get access(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(ACCESS_KEY);
    } catch {
      return null;
    }
  },
  get refresh(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set(access: string, refresh?: string) {
    try {
      localStorage.setItem(ACCESS_KEY, access);
      if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
    } catch {
      /* storage unavailable */
    }
  },
  clear() {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccess(): Promise<string | null> {
  const refresh = tokens.refresh;
  if (!refresh) return null;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { access: string };
        tokens.set(data.access);
        return data.access;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export function buildUrl(path: string, params?: Params): string {
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  params?: Params;
  form?: FormData;
  auth?: boolean;
}

async function rawRequest(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(buildUrl(path, opts.params), { method: opts.method ?? "GET", headers, body });
}

async function request(path: string, opts: RequestOptions = {}): Promise<Response> {
  let res = await rawRequest(path, opts, tokens.access);
  if (res.status === 401 && opts.auth !== false) {
    const fresh = await refreshAccess();
    if (fresh) {
      res = await rawRequest(path, opts, fresh);
    }
    if (res.status === 401) {
      tokens.clear();
      onUnauthorized?.();
    }
  }
  return res;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Authenticated file download (the API requires the bearer token, so we can't use a plain link). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await request(path);
  if (!res.ok) throw new ApiError(res.status, null);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
