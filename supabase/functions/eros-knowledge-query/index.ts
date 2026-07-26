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

  const { data: agent } = await supabase
    .from('eros_knowledge_agents')
    .select('status, system_prompt, chunk_count, name')
    .eq('group_id', body.groupId)
    .maybeSingle();

  const { data: chunks } = await supabase
    .from('eros_knowledge_chunks')
    .select('chunk_id, chunk_type, text, meta')
    .eq('group_id', body.groupId)
    .limit(80);

  const { data: urls } = await supabase
    .from('eros_knowledge_urls')
    .select('url, status')
    .eq('group_id', body.groupId);

  const urlList = (urls || []).map((u) => `- ${u.url} [${u.status}]`).join('\n') || '(nenhuma URL)';
  const chunkBlock =
    (chunks || [])
      .map((c) => `- [${c.chunk_type}] ${c.text}`)
      .join('\n') || '(nenhum chunk — rode Treinar & Publicar)';

  const history = body.messages
    .slice(-12)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const system =
    agent?.system_prompt ||
    'Você é o assistente GymSite - Pipeline (agregadores / Gurupass).';

  const prompt = [
    system,
    '',
    `Agente: ${agent?.name || '—'} | status=${agent?.status || 'draft'} | chunks=${agent?.chunk_count ?? (chunks || []).length}`,
    '',
    'Chunks indexados (use estes fatos; não invente academias):',
    chunkBlock,
    '',
    'URLs cadastradas:',
    urlList,
    '',
    'Conversa:',
    history,
    '',
    'Responda em PT-BR, só com o texto.',
  ].join('\n');

  try {
    const provider = await resolveLlmProvider(supabase);
    const result = await callLlm(prompt, provider);
    return json({
      ok: true,
      text: result.text,
      provider: result.provider,
      agent_status: agent?.status || null,
      chunk_count: (chunks || []).length,
    });
  } catch (e) {
    return json({ error: 'llm_failed', details: e instanceof Error ? e.message : String(e) }, 502);
  }
});
