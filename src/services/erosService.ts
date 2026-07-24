import {
  ErosConversation,
  ErosLead,
  ErosMessage,
  ErosPipelineItem,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export const erosService = {
  get configured() {
    return isSupabaseConfigured;
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
