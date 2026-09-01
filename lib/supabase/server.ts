import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * サーバー(Route Handler / Server Component)用 Supabase クライアント。
 * OAuth コールバックでの認可コード交換などに使う。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component から呼ばれた場合は set できないが無視してよい
          }
        },
      },
    }
  );
}
