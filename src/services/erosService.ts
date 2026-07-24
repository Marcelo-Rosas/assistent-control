import {
  ErosConversation,
  ErosLead,
  ErosMessage,
  ErosPipelineItem,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type LlmProviderOption = 'sakana' | 'ollama' | 'gemini' | 'openai';

const LLM_PROVIDERS = new Set<string>(['sakana', 'ollama', 'gemini', 'openai']);
const LLM_STORAGE_KEY = 'gymsite_llm_provider';
const AUTO_REPLY_STORAGE_KEY = 'gymsite_eros_auto_reply';

function normalizeProvider(raw: unknown): LlmProviderOption | null {
  const value = String(raw || '').toLowerCase();
  const normalized = value === 'fugu' ? 'sakana' : value;
  return LLM_PROVIDERS.has(normalized) ? (normalized as LlmProviderOption) : null;
}

async function upsertConfig(key: string, value_json: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: existing, error: selectError } = await supabase
    .from('eros_config')
    .select('id')
    .eq('key', key)
    .is('company_id', null)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) {
    const { error: updateError } = await supabase.from('eros_config').update({ value_json }).eq('id', existing.id);
    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase
      .from('eros_config')
      .insert({ key, value_json, company_id: null });
    if (insertError) throw insertError;
  }
}

export const erosService = {
  get configured() {
    return isSupabaseConfigured;
  },

  async getLlmProvider(): Promise<LlmProviderOption> {
    if (isSupabaseConfigured) {
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase
          .from('eros_config')
          .select('value_json')
          .eq('key', 'llm_provider')
          .is('company_id', null)
          .maybeSingle();
        const fromConfig = normalizeProvider(
          (data?.value_json as { provider?: string } | string | null)?.provider ?? data?.value_json,
        );
        if (fromConfig) return fromConfig;
      } catch {
        // fall through to localStorage
      }
    }
    const fromStorage = normalizeProvider(localStorage.getItem(LLM_STORAGE_KEY));
    return fromStorage || 'sakana';
  },

  async setLlmProvider(provider: LlmProviderOption): Promise<void> {
    const normalized = normalizeProvider(provider) || 'sakana';
    if (!isSupabaseConfigured) {
      localStorage.setItem(LLM_STORAGE_KEY, normalized);
      return;
    }
    await upsertConfig('llm_provider', { provider: normalized });
    localStorage.setItem(LLM_STORAGE_KEY, normalized);
  },

  async getAutoReply(): Promise<boolean> {
    if (isSupabaseConfigured) {
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase
          .from('eros_config')
          .select('value_json')
          .eq('key', 'eros_auto_reply')
          .is('company_id', null)
          .maybeSingle();
        const cfg = data?.value_json as { enabled?: boolean } | boolean | null;
        if (cfg && typeof cfg === 'object' && typeof cfg.enabled === 'boolean') return cfg.enabled;
        if (typeof cfg === 'boolean') return cfg;
      } catch {
        // fall through
      }
    }
    return localStorage.getItem(AUTO_REPLY_STORAGE_KEY) === 'true';
  },

  async setAutoReply(enabled: boolean): Promise<void> {
    if (!isSupabaseConfigured) {
      localStorage.setItem(AUTO_REPLY_STORAGE_KEY, enabled ? 'true' : 'false');
      return;
    }
    await upsertConfig('eros_auto_reply', { enabled });
    localStorage.setItem(AUTO_REPLY_STORAGE_KEY, enabled ? 'true' : 'false');
  },

  async listLeads(): Promise<ErosLead[]> {
    if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('eros_leads').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    return data as ErosLead[];
  },

  async listConversations(): Promise<ErosConversation[]> {
    if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('eros_conversations')
      .select('*')
      .order('last_message_at', { ascending: false });
    if (error) throw error;
    return data as ErosConversation[];
  },

  async listMessages(conversationId: string): Promise<ErosMessage[]> {
    if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('eros_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data as ErosMessage[];
  },

  async sendMessage(input: { conversationId: string; leadId: string; content: string }): Promise<ErosMessage> {
    if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
    const supabase = getSupabaseClient();

    // Send through Edge Function (persists + calls Meta Graph API)
    const { data, error } = await supabase.functions.invoke('eros-send-message', {
      body: {
        lead_id: input.leadId,
        conversation_id: input.conversationId,
        text: input.content,
      },
    });
    if (error) throw error;
    if (!data?.message) throw new Error('Edge Function eros-send-message retornou payload inesperado');
    return data.message as ErosMessage;
  },

  async spinGenerate(input: {
    conversationId: string;
    leadId: string;
    lastMessages: Array<{ direction: 'incoming' | 'outgoing'; content: string }>;
    goal?: string;
  }): Promise<{ suggestion: string; provider: string }> {
    if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('eros-spin-generate', {
      body: {
        lead_id: input.leadId,
        conversation_id: input.conversationId,
        last_messages: input.lastMessages,
        goal: input.goal,
      },
    });
    if (error) throw error;
    if (!data?.suggestion) throw new Error('Edge Function eros-spin-generate retornou payload inesperado');
    return { suggestion: String(data.suggestion), provider: String(data.provider || 'unknown') };
  },

  async listPipeline(): Promise<ErosPipelineItem[]> {
    if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('eros_pipeline').select('*').order('stage').order('position');
    if (error) throw error;
    return data as ErosPipelineItem[];
  },
};
