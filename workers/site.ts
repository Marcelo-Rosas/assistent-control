/**
 * GymSite pipeline — Cloudflare Worker (Static Assets SPA).
 * Serves Vite `dist/` with SPA fallback for React Router.
 * API / Edge remain on Supabase (not proxied here).
 */
interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
