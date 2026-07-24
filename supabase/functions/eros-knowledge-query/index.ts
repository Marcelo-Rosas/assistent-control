/// <reference path="../edge-runtime.d.ts" />
import { json } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { callLlm, resolveLlmProvider } from '../_shared/llm.ts';

type Body = {
  groupId: string;
  messages: Array<{ role: string; content: string }>;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.groupId || !body?.messages?.length) return json({ error: 'invalid_body' }, 400);

  const supabase = getServiceSupabase();
  const { data: urls } = await supabase
    .from('eros_knowledge_urls')
    .select('url, status')
    .eq('group_id', body.groupId);

  const urlList = (urls || []).map((u) => `- ${u.url} [${u.status}]`).join('\n') || '(nenhuma URL)';

  const history = body.messages
    .slice(-12)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const prompt = [
    'Você é o assistente GymSite - Pipeline.',
    'Use APENAS a lista de URLs cadastradas como contexto de fontes (v1 não faz crawl/embeddings).',
    'Se não souber, diga que a fonte ainda não foi indexada (status pending).',
    'Responda em PT-BR, curto.',
    '',
    'URLs do grupo:',
    urlList,
    '',
    'Conversa:',
    history,
    '',
    'Responda só com o texto.',
  ].join('\n');

  try {
    const provider = await resolveLlmProvider(supabase);
    const result = await callLlm(prompt, provider);
    return json({ ok: true, text: result.text, provider: result.provider });
  } catch (e) {
    return json({ error: 'llm_failed', details: e instanceof Error ? e.message : String(e) }, 502);
  }
});
