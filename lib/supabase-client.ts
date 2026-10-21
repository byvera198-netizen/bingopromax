import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://qidfcahfwvdbysaszfhl.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_YMUMwP2WAwEow03fi-nlJA_gYu0-uTK";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      flowType: "pkce",
    },
  },
);

export async function authorizationHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}
