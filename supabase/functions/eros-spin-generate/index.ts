import { json } from './shared/cors.ts';
import { callLlm, resolveLlmProvider } from '../_shared/llm.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';

type SpinGenerateBody = {
  lead_id: string;
  conversation_id: string;
  last_messages?: Array<{ direction: 'incoming' | 'outgoing'; content: string }>;
  goal?: string; // e.g. "marcar_call" | "qualificar" | "coletar_endereco"
  // provider is ignored in v1 — resolved via eros_config → env → sakana
};

function buildSpinPrompt(input: SpinGenerateBody) {
  const history = (input.last_messages || []).slice(-12);
  const lines = history
    .map((m) => `${m.direction === 'incoming' ? 'Cliente' : 'GymSite'}: ${m.content}`)
    .join('\n');

  return [
    'Você é o assistente comercial GymSite Intelligence (viabilidade de academias).',
    'Contexto: conversa via Instagram/WhatsApp com dono, gestor ou investidor de academia/estúdio.',
    'Domínio: expansão de pontos, mercado fitness, agregadores (Gurupass/TotalPass/Wellhub), geo e regulatório — não é frete nem logística.',
    'Objetivo: responder usando SPIN Selling, curto e natural, PT-BR.',
    'Regras:',
    '- máximo 600 caracteres',
    '- não use emojis',
    '- faça 1 pergunta por vez',
    '- termine com um CTA claro (ex: confirmar cidade/bairro, plano mínimo, etapa do projeto).',
    `Goal: ${input.goal || 'qualificar'}`,
    '',
    'Histórico:',
    lines || '(sem histórico)',
    '',
    'Responda apenas com o texto da mensagem.',
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const body = (await req.json().catch(() => null)) as SpinGenerateBody | null;
  if (!body?.lead_id || !body?.conversation_id) return json({ error: 'invalid_body' }, 400);

  const prompt = buildSpinPrompt(body);

  let suggestion = '';
  let provider = 'unknown';
  let model = '';

  try {
    const supabase = getServiceSupabase();
    const resolved = await resolveLlmProvider(supabase);
    const result = await callLlm(prompt, resolved);
    suggestion = result.text;
    provider = result.provider;
    model = result.model;
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return json({ error: 'llm_failed', details }, 502);
  }

  try {
    const supabase = getServiceSupabase();
    await supabase.from('eros_activity_log').insert({
      actor: 'eros-spin-generate',
      action: 'spin_suggestion',
      entity_type: 'conversation',
      entity_id: body.conversation_id,
      meta_json: {
        provider,
        model,
        lead_id: body.lead_id,
        suggestion,
      },
    });
  } catch {
    // ignore
  }

  return json({ ok: true, provider, model, suggestion });
});
