export function getEvolutionConfig() {
  const url = Deno.env.get('EVOLUTION_URL');
  const instance = Deno.env.get('EVOLUTION_INSTANCE');
  const apiKey = Deno.env.get('EVOLUTION_API_KEY');
  if (!url || !instance || !apiKey) {
    throw new Error('Missing EVOLUTION_URL, EVOLUTION_INSTANCE, or EVOLUTION_API_KEY');
  }
  return { url: url.replace(/\/$/, ''), instance, apiKey };
}

export async function sendEvolutionText(input: { number: string; text: string }) {
  const { url, instance, apiKey } = getEvolutionConfig();
  const resp = await fetch(`${url}/message/sendText/${instance}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: apiKey,
    },
    body: JSON.stringify({ number: input.number, text: input.text }),
  });
  const raw = await resp.json().catch(() => ({}));
  return { ok: resp.ok, raw };
}
