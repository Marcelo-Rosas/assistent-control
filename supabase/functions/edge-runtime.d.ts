// Typings mínimos para Supabase Edge Functions (Deno runtime)
// Objetivo: silenciar erros do TypeScript no editor para arquivos em supabase/functions/**

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  // fallback typing: we only need createClient signature enough for editor
  export function createClient(url: string, key: string, options?: any): any;
}

