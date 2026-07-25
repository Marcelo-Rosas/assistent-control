/// <reference path="../edge-runtime.d.ts" />
import { json } from '../_shared/cors.ts';
import { getChannelProvider } from '../_shared/channel.ts';
import { getEvolutionConfig } from '../_shared/evolutionClient.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const channel = getChannelProvider();
  const webhookPath = '/functions/v1/eros-evolution-webhook';

  if (channel !== 'evolution') {
    return json({
      ok: true,
      channel,
      evolution: { configured: false, reason: 'CHANNEL_PROVIDER!=evolution' },
      webhook_path: webhookPath,
    });
  }

  let cfg: ReturnType<typeof getEvolutionConfig>;
  try {
    cfg = getEvolutionConfig();
  } catch (e) {
    return json({
      ok: false,
      channel,
      evolution: {
        configured: false,
        reason: String(e),
      },
      webhook_path: webhookPath,
    }, 200);
  }

  try {
    const resp = await fetch(`${cfg.url}/instance/connectionState/${cfg.instance}`, {
      headers: { apikey: cfg.apiKey },
    });
    const raw = await resp.json().catch(() => ({}));
    const state = raw?.instance?.state ?? raw?.state ?? null;

    return json({
      ok: resp.ok,
      channel,
      evolution: {
        configured: true,
        url: cfg.url,
        instance: cfg.instance,
        api_key_set: true,
        http_status: resp.status,
        state,
        raw: resp.ok ? { instance: raw?.instance } : raw,
      },
      webhook_path: webhookPath,
    });
  } catch (e) {
    return json({
      ok: false,
      channel,
      evolution: {
        configured: true,
        url: cfg.url,
        instance: cfg.instance,
        api_key_set: true,
        error: String(e),
      },
      webhook_path: webhookPath,
    }, 200);
  }
});
