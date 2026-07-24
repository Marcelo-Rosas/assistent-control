import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Tipagem genérica por enquanto; será refinada com Database gerado de schema.sql
type Database = any;

let client: SupabaseClient<Database> | null = null;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// JWT anon (eyJ...) funciona com @supabase/supabase-js em todos os fluxos.
// sb_publishable_* é mais novo; use anon se aparecer "Invalid API key".
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const key =
  anonKey?.startsWith('eyJ') ? anonKey : publishableKey?.startsWith('sb_publishable_') ? publishableKey : anonKey || publishableKey;

export const isSupabaseConfigured = Boolean(url && key);

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (ou VITE_SUPABASE_ANON_KEY) no .env antes de usar o cliente.'
    );
  }

  if (!client) {
    client = createClient<Database>(url!, key!, {
      auth: {
        persistSession: false,
      },
    });
  }

  return client;
}

