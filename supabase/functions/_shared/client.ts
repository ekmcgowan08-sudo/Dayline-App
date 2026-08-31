// Shared helpers for Supabase Edge Functions (Deno). Every function in
// this directory uses the service-role client ONLY on the server side —
// the service role key is read from an environment variable that is never
// bundled into the mobile app (see .env.example: it is listed under
// "server-side only").
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Verifies the caller's Supabase session JWT and returns their user id.
 * Never trusts a user id passed in the request body — that would let a
 * client impersonate anyone by just changing a field. */
export async function authenticate(req: Request): Promise<{ userId: string } | { error: Response }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return { error: json({ error: 'missing_authorization' }, 401) };
  const token = authHeader.slice('Bearer '.length);

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { error: json({ error: 'invalid_token' }, 401) };
  return { userId: data.user.id };
}
