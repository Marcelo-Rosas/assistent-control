/// <reference path="../edge-runtime.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asUuid(raw: string | null | undefined): string | null {
  const v = String(raw || '').trim();
  return UUID_RE.test(v) ? v : null;
}

/**
 * Real JWT only — app_metadata.company_id (never user_metadata, never x-company-id header).
 * Returns null when caller is anon / no user session (global operator).
 */
export async function resolveUserCompanyIdFromJwt(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return null;

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return null;

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return null;

  const app = (data.user.app_metadata || {}) as Record<string, unknown>;
  return asUuid(app.company_id != null ? String(app.company_id) : null);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** content_hash = sha256(group_id + chunk_type + text) */
export async function contentHash(groupId: string, chunkType: string, text: string): Promise<string> {
  return sha256Hex(`${groupId}|${chunkType}|${text}`);
}
