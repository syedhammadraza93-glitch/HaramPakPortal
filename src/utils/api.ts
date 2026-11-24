// Small fetch wrapper for the Express API (./server). Responses look like { success, message?, data }.
// The access token lives in memory only; the refresh token is an httpOnly cookie set by the server.

export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  errors?: FieldError[];
  constructor(status: number, message: string, errors?: FieldError[]) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export type AgencyStatus =
  | "pending_email_verification"
  | "pending_approval"
  | "information_required"
  | "active"
  | "suspended"
  | "rejected"
  | "deactivated";

export interface Me {
  id: string;
  email: string;
  fullName: string;
  type: "staff" | "agent";
  roles: string[];
  permissions: string[];
  agency: { id: string; name: string; agentCode: string | null; status: AgencyStatus; access: { catalogue: boolean; bookings: boolean; finance: boolean } } | null;
  /** A 6-digit code is emailed at every login. */
  mfaEnabled: boolean;
  /** The role requires it, so it cannot be turned off. */
  mfaRequired: boolean;
  /** Two-factor login is switched on for the portal (Settings → Security). */
  mfaAvailable: boolean;
}

export interface Session {
  accessToken: string;
  user: Me;
}

export interface Envelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface Options {
  body?: unknown;
  form?: FormData;
  query?: Query;
}

let accessToken: string | null = null;
let sessionListener: ((session: Session | null) => void) | null = null;
let refreshing: Promise<Session | null> | null = null;

/** Redux subscribes here so a refresh that happens inside any request updates the logged-in user. */
export function onSessionChange(listener: (session: Session | null) => void) {
  sessionListener = listener;
}

export function setSession(session: Session | null) {
  accessToken = session?.accessToken ?? null;
  sessionListener?.(session);
}

/** Uses the refresh cookie to get a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<Session | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
        if (!res.ok) return null;
        const json = (await res.json()) as Envelope<Session>;
        return json.data;
      } catch {
        return null;
      }
    })().then((session) => {
      setSession(session);
      refreshing = null;
      return session;
    });
  }
  return refreshing;
}

const NO_RETRY = ["/auth/login", "/auth/login/mfa", "/auth/refresh", "/auth/logout"];

function buildUrl(path: string, query?: Query) {
  const params = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  });
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ""}`;
}

async function send(method: string, path: string, opts: Options = {}, retry = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: "include",
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your internet connection or that the API is running.");
  }
  if (res.status === 401 && retry && !NO_RETRY.includes(path)) {
    const session = await refreshSession();
    if (session) return send(method, path, opts, false);
  }
  return res;
}

async function envelope<T>(method: string, path: string, opts?: Options): Promise<Envelope<T>> {
  const res = await send(method, path, opts);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.message || `Request failed (${res.status})`, json?.errors);
  return json as Envelope<T>;
}

export const api = {
  /** GET returning just `data`. */
  get: async <T>(path: string, query?: Query) => (await envelope<T>("GET", path, { query })).data,
  /** Mutations return the whole envelope so the caller can show `message`. */
  post: <T = unknown>(path: string, body?: unknown) => envelope<T>("POST", path, { body: body ?? {} }),
  postForm: <T = unknown>(path: string, form: FormData) => envelope<T>("POST", path, { form }),
  patch: <T = unknown>(path: string, body: unknown) => envelope<T>("PATCH", path, { body }),
  put: <T = unknown>(path: string, body: unknown) => envelope<T>("PUT", path, { body }),
  del: <T = unknown>(path: string) => envelope<T>("DELETE", path),

  /** Opens a protected file (e.g. an agency document) in a new tab. */
  openFile: async (path: string) => {
    const tab = window.open("", "_blank");
    const res = await send("GET", path);
    if (!res.ok) {
      tab?.close();
      const json = await res.json().catch(() => null);
      throw new ApiError(res.status, json?.message || "Could not open the file");
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  /** Downloads a protected file under the name the server gives it (e.g. an Excel export). */
  downloadFile: async (path: string) => {
    const res = await send("GET", path);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new ApiError(res.status, json?.message || "Could not download the file");
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "download";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

/** Turns API field errors into { field: message } for forms. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.errors) return {};
  return Object.fromEntries(error.errors.map((e) => [e.path, e.message]));
}

/**
 * Readable message from any error. Redux thunks reject with a plain { message } object
 * (not an Error instance), so read `message` from objects too.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Something went wrong";
}
