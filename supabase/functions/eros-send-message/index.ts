/// <reference path="../edge-runtime.d.ts" />
import { json } from '../_shared/cors.ts';
import { getChannelProvider } from '../_shared/channel.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { sendEvolutionText } from '../_shared/evolutionClient.ts';
import { digitsOnly } from '../_shared/whatsappNormalize.ts';

type SendMessageBody = {
  lead_id: string;
  conversation_id: string;
  text: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const body = (await req.json().catch(() => null)) as SendMessageBody | null;
  if (!body?.lead_id || !body?.conversation_id || !body?.text) {
    return json({ error: 'invalid_body' }, 400);
  }

  const provider = getChannelProvider();
  const supabase = getServiceSupabase();

  const { data: lead, error: leadErr } = await supabase
    .from('eros_leads')
    .select('*')
    .eq('id', body.lead_id)
    .single();
  if (leadErr) return json({ error: 'lead_not_found', details: leadErr.message }, 404);

  const { data: messageRow, error: msgErr } = await supabase
    .from('eros_messages')
    .insert({
      conversation_id: body.conversation_id,
      lead_id: body.lead_id,
      direction: 'outgoing',
      message_type: 'text',
      status: 'sent',
      content: body.text,
      spin_phase: null,
    })
    .select('*')
    .single();
  if (msgErr) return json({ error: 'db_insert_failed', details: msgErr.message }, 500);

  const updatePreview = async () => {
    await supabase
      .from('eros_conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body.text.slice(0, 200),
      })
      .eq('id', body.conversation_id);
  };

  if (provider === 'evolution') {
    if (lead.channel !== 'whatsapp') {
      return json({ error: 'unsupported_channel', channel: lead.channel }, 400);
    }
    const number = lead.phone || digitsOnly(String(lead.external_id || ''));
    if (!number) return json({ error: 'missing_phone' }, 400);

    let result: { ok: boolean; raw: unknown };
    try {
      result = await sendEvolutionText({ number, text: body.text });
    } catch (e) {
      const details = e instanceof Error ? e.message : String(e);
      await supabase.from('eros_messages').update({ status: 'failed' }).eq('id', messageRow.id);
      return json({ error: 'evolution_not_configured', details }, 503);
    }

    const newStatus = result.ok ? 'delivered' : 'failed';
    await supabase.from('eros_messages').update({ status: newStatus }).eq('id', messageRow.id);
    await updatePreview();

    return json(
      { ok: result.ok, message: { ...messageRow, status: newStatus }, evolution: result.raw },
      result.ok ? 200 : 502,
    );
  }

  // Meta path
  const metaToken = Deno.env.get('META_ACCESS_TOKEN');
  if (!metaToken) return json({ error: 'META_ACCESS_TOKEN not set' }, 503);

  if (lead.channel !== 'instagram') {
    return json({ error: 'unsupported_channel', channel: lead.channel }, 400);
  }
  if (!lead.external_id) return json({ error: 'missing_external_id' }, 400);

  const response = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${metaToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: lead.external_id },
      message: { text: body.text },
    }),
  });

  const respJson = await response.json().catch(() => ({}));
  const newStatus = response.ok ? 'delivered' : 'failed';
  await supabase.from('eros_messages').update({ status: newStatus }).eq('id', messageRow.id);
  await updatePreview();

  return json(
    { ok: response.ok, message: { ...messageRow, status: newStatus }, meta: respJson },
    response.ok ? 200 : 502,
  );
});
