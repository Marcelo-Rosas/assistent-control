import { json, text } from '../_shared/cors.ts';
import { getChannelProvider, ignoredProviderResponse } from '../_shared/channel.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        attachments?: Array<{
          type?: string;
          payload?: { url?: string };
        }>;
      };
    }>;
  }>;
};

function parseMessage(m: any): { text: string | null; mediaUrl: string | null; type: 'text' | 'image' | 'audio' } {
  const textVal = typeof m?.text === 'string' ? m.text : null;
  const att = Array.isArray(m?.attachments) ? m.attachments[0] : null;
  const mediaUrl = att?.payload?.url ? String(att.payload.url) : null;
  const type = mediaUrl ? (att?.type === 'audio' ? 'audio' : 'image') : 'text';
  return { text: textVal, mediaUrl, type };
}

async function upsertLead(input: {
  channel: 'instagram';
  external_id: string;
  name: string;
  avatar_url?: string | null;
  username?: string | null;
  last_contact_at: string;
}) {
  const supabase = getServiceSupabase();

  const { data: existing, error: existingErr } = await supabase
    .from('eros_leads')
    .select('id')
    .eq('channel', input.channel)
    .eq('external_id', input.external_id)
    .maybeSingle();

  if (existingErr) throw existingErr;

  if (existing?.id) {
    const { data, error } = await supabase
      .from('eros_leads')
      .update({
        name: input.name,
        username: input.username,
        avatar_url: input.avatar_url,
        last_contact_at: input.last_contact_at,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('eros_leads')
    .insert({
      channel: input.channel,
      external_id: input.external_id,
      name: input.name,
      username: input.username,
      avatar_url: input.avatar_url,
      classification: 'morno',
      score: 0,
      status: 'new',
      tags: [],
      last_contact_at: input.last_contact_at,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getOrCreateConversation(input: {
  lead_id: string;
  channel: 'instagram';
  external_thread_id: string;
  last_message_at: string;
  last_message_preview: string;
}) {
  const supabase = getServiceSupabase();

  const { data: existing, error: existingErr } = await supabase
    .from('eros_conversations')
    .select('*')
    .eq('lead_id', input.lead_id)
    .eq('channel', input.channel)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing?.id) {
    const { data, error } = await supabase
      .from('eros_conversations')
      .update({
        external_thread_id: input.external_thread_id,
        last_message_at: input.last_message_at,
        last_message_preview: input.last_message_preview,
        unread_count: (existing.unread_count ?? 0) + 1,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('eros_conversations')
    .insert({
      lead_id: input.lead_id,
      channel: input.channel,
      external_thread_id: input.external_thread_id,
      last_message_at: input.last_message_at,
      last_message_preview: input.last_message_preview,
      unread_count: 1,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function insertInboundMessage(input: {
  conversation_id: string;
  lead_id: string;
  content: string | null;
  media_url: string | null;
  message_type: 'text' | 'image' | 'audio';
}) {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('eros_messages')
    .insert({
      conversation_id: input.conversation_id,
      lead_id: input.lead_id,
      direction: 'incoming',
      message_type: input.message_type,
      status: 'delivered',
      content: input.content,
      media_url: input.media_url,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return text('ok', 200);

  // Meta webhook verification
  if (req.method === 'GET') {
    if (getChannelProvider() !== 'meta') {
      return json(ignoredProviderResponse('meta'), 200);
    }

    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const verifyToken = Deno.env.get('META_VERIFY_TOKEN');
    if (!verifyToken) return text('META_VERIFY_TOKEN not set', 500);

    if (mode === 'subscribe' && token === verifyToken && challenge) {
      return text(challenge, 200);
    }
    return text('forbidden', 403);
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (getChannelProvider() !== 'meta') {
    return json(ignoredProviderResponse('meta'), 200);
  }

  const payload = (await req.json().catch(() => null)) as MetaWebhookPayload | null;
  if (!payload) return json({ error: 'invalid_json' }, 400);

  const processed: any[] = [];
  const entries = payload.entry ?? [];

  for (const entry of entries) {
    const messaging = entry.messaging ?? [];
    for (const ev of messaging) {
      const senderId = ev.sender?.id;
      const ts = typeof ev.timestamp === 'number' ? ev.timestamp : Date.now();
      const createdAt = new Date(ts).toISOString();
      if (!senderId) continue;

      const parsed = parseMessage(ev.message);
      const preview = (parsed.text || (parsed.mediaUrl ? `[${parsed.type}]` : '') || '').slice(0, 200);

      const lead = await upsertLead({
        channel: 'instagram',
        external_id: senderId,
        name: `IG User ${senderId}`,
        avatar_url: null,
        username: null,
        last_contact_at: createdAt,
      });

      const conversation = await getOrCreateConversation({
        lead_id: lead.id,
        channel: 'instagram',
        external_thread_id: senderId,
        last_message_at: createdAt,
        last_message_preview: preview,
      });

      const message = await insertInboundMessage({
        conversation_id: conversation.id,
        lead_id: lead.id,
        content: parsed.text,
        media_url: parsed.mediaUrl,
        message_type: parsed.type,
      });

      processed.push({ lead_id: lead.id, conversation_id: conversation.id, message_id: message.id });
    }
  }

  return json({ ok: true, processed_count: processed.length, processed });
});
