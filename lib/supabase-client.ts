import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://mnshvsxhntqsmzbvomhe.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_DBOaxRwgSRDSmdBtTEKTsQ_GB_sT8ZA";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      flowType: "implicit",
    },
  },
);

export async function authorizationHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}
