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
  if (!response.ok)
    throw new Error(
      body.error ?? `Không thực hiện được yêu cầu (${response.status}).`,
    );
  return body as T;
}
