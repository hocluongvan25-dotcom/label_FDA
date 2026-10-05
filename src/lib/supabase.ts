import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
export const isSupabaseConfigured = () =>
  !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
export const isDemoEnabled = () =>
  process.env.NEXT_PUBLIC_ENABLE_DEMO !== "false";
export const isSupabaseRequested = () =>
  !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) || !isDemoEnabled();
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured())
    throw new Error("Chưa cấu hình Supabase. Xem .env.example và README.");
  if (!client)
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  return client;
}
/** API error that keeps the server's per-field validation messages. */
export class ApiError extends Error {
  readonly fields: { path: string; message: string }[];
  constructor(
    message: string,
    fields: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.fields = fields;
  }
}
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  if (!session)
    throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fields: { path: string; message: string }[] = Array.isArray(
      body.fields,
    )
      ? body.fields.filter(
          (f: unknown) =>
            f && typeof (f as { path?: unknown }).path === "string",
        )
      : [];
    const base: string =
      body.error ?? `Không thực hiện được yêu cầu (${response.status}).`;
    throw new ApiError(
      fields.length
        ? `${base} ${fields.map((f) => `${f.path}: ${f.message}`).join(" · ")}`
        : base,
      fields,
    );
  }
  return body as T;
}
