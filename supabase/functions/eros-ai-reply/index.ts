/// <reference path="../edge-runtime.d.ts" />
import { json } from '../_shared/cors.ts';
import { getChannelProvider } from '../_shared/channel.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { callLlm, resolveLlmProvider } from '../_shared/llm.ts';
import { sendEvolutionText } from '../_shared/evolutionClient.ts';
import { setLeadStage } from '../_shared/stage.ts';
import { digitsOnly } from '../_shared/whatsappNormalize.ts';

type AiReplyBody = {
  lead_id: string;
  conversation_id: string;
  trigger_message_id?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (getChannelProvider() !== 'evolution') {
    return json({ ok: true, skipped: 'channel_not_evolution' }, 200);
  }

  const body = (await req.json().catch(() => null)) as AiReplyBody | null;
  if (!body?.lead_id || !body?.conversation_id) {
    return json({ error: 'invalid_body' }, 400);
  }

  const supabase = getServiceSupabase();

  const { data: lead, error: leadErr } = await supabase
    .from('eros_leads')
    .select('*')
    .eq('id', body.lead_id)
    .single();
  if (leadErr || !lead) return json({ error: 'lead_not_found' }, 404);

  if (lead.channel !== 'whatsapp') {
    return json({ ok: true, skipped: 'unsupported_channel' }, 200);
  }

  const { data: recent, error: msgErr } = await supabase
    .from('eros_messages')
    .select('*')
    .eq('conversation_id', body.conversation_id)
    .order('created_at', { ascending: false })
    .limit(12);
  if (msgErr) return json({ error: 'messages_failed', details: msgErr.message }, 500);

  const messages = (recent || []).slice().reverse();
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'incoming');
  if (!lastInbound || lastInbound.message_type !== 'text' || !lastInbound.content) {
    return json({ ok: true, skipped: 'non_text' }, 200);
  }

  const history = messages
    .map((m) => `${m.direction === 'incoming' ? 'Cliente' : 'GymSite'}: ${m.content || ''}`)
    .join('\n');

  const prompt = [
    'Você é o assistente comercial GymSite Intelligence (viabilidade de academias).',
    'Contexto: conversa WhatsApp com dono, gestor ou investidor de academia/estúdio.',
    'Domínio: expansão de pontos, mercado fitness, agregadores (Gurupass/TotalPass/Wellhub), geo e regulatório — não é frete nem logística.',
    'Objetivo: responder com SPIN Selling, curto e natural, PT-BR.',
    'Regras: máximo 600 caracteres; sem emojis; 1 pergunta por vez; CTA claro (bairro, plano, etapa do projeto).',
    '',
    'Histórico:',
    history || '(sem histórico)',
    '',
    'Responda apenas com o texto da mensagem.',
  ].join('\n');

  let suggestion = '';
  let provider = 'unknown';
  try {
    const llmProvider = await resolveLlmProvider(supabase);
    const result = await callLlm(prompt, llmProvider);
    suggestion = result.text.trim();
    provider = result.provider;
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    return json({ error: 'llm_failed', details }, 502);
  }

  if (!suggestion) return json({ error: 'empty_suggestion' }, 502);

  const number = lead.phone || digitsOnly(String(lead.external_id || ''));
  if (!number) return json({ error: 'missing_phone' }, 400);

  let sendResult: { ok: boolean; raw: unknown };
  try {
    sendResult = await sendEvolutionText({ number, text: suggestion });
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    return json({ error: 'evolution_not_configured', details }, 503);
  }

  const { data: messageRow, error: insertErr } = await supabase
    .from('eros_messages')
    .insert({
      conversation_id: body.conversation_id,
      lead_id: body.lead_id,
      direction: 'outgoing',
      message_type: 'text',
      status: sendResult.ok ? 'delivered' : 'failed',
      content: suggestion,
      spin_phase: null,
    })
    .select('*')
    .single();
  if (insertErr) return json({ error: 'db_insert_failed', details: insertErr.message }, 500);

  await supabase
    .from('eros_conversations')
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: suggestion.slice(0, 200),
    })
    .eq('id', body.conversation_id);

  // Simple CRM bump: hot / high score → qualifying (both lead.status + pipeline.stage)
  if (lead.classification === 'hot' || Number(lead.score) >= 80) {
    try {
      await setLeadStage(supabase, body.lead_id, 'qualifying');
    } catch {
      // non-fatal
    }
  }

  try {
    await supabase.from('eros_activity_log').insert({
      actor: 'eros-ai-reply',
      action: 'auto_reply',
      entity_type: 'conversation',
      entity_id: body.conversation_id,
      meta_json: { provider, lead_id: body.lead_id, ok: sendResult.ok },
    });
  } catch {
    // ignore
  }

  return json({
    ok: sendResult.ok,
    provider,
    message: messageRow,
    evolution: sendResult.raw,
  }, sendResult.ok ? 200 : 502);
});
