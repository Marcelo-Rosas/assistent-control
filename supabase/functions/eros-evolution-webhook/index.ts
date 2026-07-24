/// <reference path="../edge-runtime.d.ts" />
import { json } from '../_shared/cors.ts';
import { getChannelProvider, ignoredProviderResponse } from '../_shared/channel.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { normalizeWhatsAppJid } from '../_shared/whatsappNormalize.ts';
import { ensurePipelineRow } from '../_shared/stage.ts';

type MessageType = 'text' | 'image' | 'audio';

type ParsedInbound = {
  remoteJid: string;
  fromMe: boolean;
  providerMessageId: string | null;
  pushName: string | null;
  text: string | null;
  messageType: MessageType;
  mediaUrl: string | null;
};

function unwrapMessageNode(message: any): any {
  if (!message || typeof message !== 'object') return null;
  if (message.ephemeralMessage?.message) return unwrapMessageNode(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessageNode(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessageNode(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage?.message) {
    return unwrapMessageNode(message.documentWithCaptionMessage.message);
  }
  return message;
}

function parseEvolutionItem(raw: any): ParsedInbound | null {
  if (!raw || typeof raw !== 'object') return null;

  const key = raw.key ?? {};
  const remoteJid = String(key.remoteJid || raw.remoteJid || '').trim();
  if (!remoteJid) return null;

  const fromMe = Boolean(key.fromMe ?? raw.fromMe);
  const providerMessageId = key.id != null ? String(key.id) : raw.id != null ? String(raw.id) : null;
  const pushName =
    typeof raw.pushName === 'string'
      ? raw.pushName
      : typeof raw.pushname === 'string'
        ? raw.pushname
        : null;

  const msg = unwrapMessageNode(raw.message);
  let text: string | null = null;
  let messageType: MessageType = 'text';
  let mediaUrl: string | null = null;

  if (msg) {
    if (typeof msg.conversation === 'string') {
      text = msg.conversation;
    } else if (typeof msg.extendedTextMessage?.text === 'string') {
      text = msg.extendedTextMessage.text;
    } else if (msg.imageMessage) {
      messageType = 'image';
      text = typeof msg.imageMessage.caption === 'string' ? msg.imageMessage.caption : null;
      mediaUrl = msg.imageMessage.url ? String(msg.imageMessage.url) : null;
    } else if (msg.audioMessage) {
      messageType = 'audio';
      mediaUrl = msg.audioMessage.url ? String(msg.audioMessage.url) : null;
    } else if (msg.videoMessage) {
      messageType = 'image';
      text = typeof msg.videoMessage.caption === 'string' ? msg.videoMessage.caption : null;
      mediaUrl = msg.videoMessage.url ? String(msg.videoMessage.url) : null;
    }
  }

  return { remoteJid, fromMe, providerMessageId, pushName, text, messageType, mediaUrl };
}

function extractUpsertItems(payload: any): any[] {
  if (!payload || typeof payload !== 'object') return [];

  const event = String(payload.event || payload.type || '').toLowerCase();
  if (event && !event.includes('messages.upsert') && event !== 'messages_upsert') {
    // Still allow payloads that omit event but carry message data
    if (!payload.data && !payload.key) return [];
  }

  const data = payload.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages)) return data.messages;
  if (data?.key || data?.message) return [data];
  if (payload.key || payload.message) return [payload];
  return [];
}

async function readAutoReplyFlag(supabase: any): Promise<boolean> {
  const { data } = await supabase
    .from('eros_config')
    .select('value_json')
    .eq('key', 'eros_auto_reply')
    .is('company_id', null)
    .maybeSingle();

  const cfg = data?.value_json;
  if (cfg && typeof cfg === 'object' && typeof cfg.enabled === 'boolean') {
    return cfg.enabled;
  }
  if (typeof cfg === 'boolean') return cfg;

  return Deno.env.get('EROS_AUTO_REPLY') === 'true';
}

async function upsertWhatsAppLead(input: {
  supabase: any;
  external_id: string;
  phone: string;
  name: string;
  last_contact_at: string;
}) {
  const { supabase, external_id, phone, name, last_contact_at } = input;

  const { data: existing, error: existingErr } = await supabase
    .from('eros_leads')
    .select('*')
    .eq('channel', 'whatsapp')
    .eq('phone', phone)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  if (existing?.id) {
    const { data, error } = await supabase
      .from('eros_leads')
      .update({
        external_id,
        name: name || existing.name,
        last_contact_at,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from('eros_leads')
    .insert({
      channel: 'whatsapp',
      external_id,
      phone,
      name: name || phone,
      classification: 'morno',
      score: 0,
      status: 'new',
      tags: [],
      last_contact_at,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function getOrCreateConversation(input: {
  supabase: any;
  lead_id: string;
  external_thread_id: string;
  last_message_at: string;
  last_message_preview: string;
}) {
  const { supabase, lead_id, external_thread_id, last_message_at, last_message_preview } = input;

  const { data: existing, error: existingErr } = await supabase
    .from('eros_conversations')
    .select('*')
    .eq('lead_id', lead_id)
    .eq('channel', 'whatsapp')
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  if (existing?.id) {
    const { data, error } = await supabase
      .from('eros_conversations')
      .update({
        external_thread_id,
        last_message_at,
        last_message_preview,
        unread_count: (existing.unread_count ?? 0) + 1,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from('eros_conversations')
    .insert({
      lead_id,
      channel: 'whatsapp',
      external_thread_id,
      last_message_at,
      last_message_preview,
      unread_count: 1,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  return /duplicate key|unique constraint/i.test(error.message || '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);

  // Evolution Manager / browser often probe with GET — health only, no writes
  if (req.method === 'GET') {
    return json({
      ok: true,
      service: 'eros-evolution-webhook',
      channel: getChannelProvider(),
      hint: 'POST MESSAGES_UPSERT with header apikey',
    }, 200);
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (getChannelProvider() !== 'evolution') {
    return json(ignoredProviderResponse('evolution'), 200);
  }

  const secret = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || Deno.env.get('EVOLUTION_API_KEY');
  const headerKey =
    req.headers.get('apikey') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!secret || headerKey !== secret) return json({ error: 'unauthorized' }, 401);

  const payload = await req.json().catch(() => null);
  if (!payload) return json({ error: 'invalid_json' }, 400);

  const items = extractUpsertItems(payload);
  if (items.length === 0) return json({ ok: true, processed_count: 0 }, 200);

  let supabase: ReturnType<typeof getServiceSupabase>;
  try {
    supabase = getServiceSupabase();
  } catch (e) {
    return json({ error: 'supabase_config', details: String(e) }, 500);
  }

  const processed: Array<{
    lead_id: string;
    conversation_id: string;
    message_id: string | null;
    duplicate?: boolean;
  }> = [];

  for (const item of items) {
    const parsed = parseEvolutionItem(item);
    if (!parsed) continue;
    if (parsed.fromMe) continue;
    if (parsed.remoteJid === 'status@broadcast' || parsed.remoteJid.endsWith('@broadcast')) continue;

    const { external_id, phone } = normalizeWhatsAppJid(parsed.remoteJid);
    if (!phone) continue;

    // Idempotency: skip before bumping unread if provider id already stored
    if (parsed.providerMessageId) {
      const { data: existingMsg } = await supabase
        .from('eros_messages')
        .select('id, lead_id, conversation_id')
        .eq('provider_message_id', parsed.providerMessageId)
        .maybeSingle();
      if (existingMsg?.id) {
        processed.push({
          lead_id: existingMsg.lead_id,
          conversation_id: existingMsg.conversation_id,
          message_id: existingMsg.id,
          duplicate: true,
        });
        continue;
      }
    }

    const now = new Date().toISOString();
    const preview = (
      parsed.text ||
      (parsed.mediaUrl ? `[${parsed.messageType}]` : '') ||
      ''
    ).slice(0, 200);

    try {
      const lead = await upsertWhatsAppLead({
        supabase,
        external_id,
        phone,
        name: parsed.pushName || phone,
        last_contact_at: now,
      });

      const conversation = await getOrCreateConversation({
        supabase,
        lead_id: lead.id,
        external_thread_id: external_id,
        last_message_at: now,
        last_message_preview: preview,
      });

      const { data: messageRow, error: msgErr } = await supabase
        .from('eros_messages')
        .insert({
          conversation_id: conversation.id,
          lead_id: lead.id,
          direction: 'incoming',
          message_type: parsed.messageType,
          status: 'delivered',
          content: parsed.text,
          media_url: parsed.mediaUrl,
          provider_message_id: parsed.providerMessageId,
        })
        .select('*')
        .single();

      if (msgErr) {
        if (isUniqueViolation(msgErr)) {
          processed.push({
            lead_id: lead.id,
            conversation_id: conversation.id,
            message_id: null,
            duplicate: true,
          });
          continue;
        }
        throw new Error(msgErr.message);
      }

      await ensurePipelineRow(supabase, lead.id);

      const auto = (await readAutoReplyFlag(supabase)) === true;
      if (auto && parsed.messageType === 'text' && parsed.text) {
        // @ts-ignore EdgeRuntime available on Supabase Edge
        EdgeRuntime.waitUntil(
          supabase.functions.invoke('eros-ai-reply', {
            body: {
              lead_id: lead.id,
              conversation_id: conversation.id,
              trigger_message_id: messageRow.id,
            },
          }),
        );
      }

      processed.push({
        lead_id: lead.id,
        conversation_id: conversation.id,
        message_id: messageRow.id,
      });
    } catch (e) {
      return json(
        {
          error: 'processing_failed',
          details: e instanceof Error ? e.message : String(e),
          processed_count: processed.length,
          processed,
        },
        500,
      );
    }
  }

  return json({ ok: true, processed_count: processed.length, processed }, 200);
});
