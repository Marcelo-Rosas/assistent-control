import { useCallback, useEffect, useMemo, useState } from 'react';
import { erosService } from '../services/erosService';
import { ErosConversation, ErosLead, ErosMessage, ErosPipelineItem } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';

export function useEros() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [leads, setLeads] = useState<ErosLead[]>([]);
  const [conversations, setConversations] = useState<ErosConversation[]>([]);
  const [pipeline, setPipeline] = useState<ErosPipelineItem[]>([]);

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ErosMessage[]>>({});

  const needsSetup = !isSupabaseConfigured;

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const loadBase = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLeads([]);
      setConversations([]);
      setPipeline([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [l, c, p] = await Promise.all([
        erosService.listLeads(),
        erosService.listConversations(),
        erosService.listPipeline(),
      ]);
      setLeads(l);
      setConversations(c);
      setPipeline(p);
    } catch (e: any) {
      setError(e?.message ?? 'Falha ao carregar dados do Eros');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectConversation = useCallback(async (conversationId: string) => {
    setSelectedConversationId(conversationId);
    if (messagesByConversation[conversationId]) return;

    try {
      const msgs = await erosService.listMessages(conversationId);
      setMessagesByConversation((prev) => ({ ...prev, [conversationId]: msgs }));
    } catch (e: any) {
      setError(e?.message ?? 'Falha ao carregar mensagens');
    }
  }, [messagesByConversation]);

  const sendMessage = useCallback(async (input: { conversationId: string; leadId: string; content: string }) => {
    try {
      const msg = await erosService.sendMessage(input);
      setMessagesByConversation((prev) => {
        const current = prev[input.conversationId] ?? [];
        return { ...prev, [input.conversationId]: [...current, msg] };
      });
      // refresh conversation list to update previews (fallback; realtime will also keep it fresh)
      try {
        const c = await erosService.listConversations();
        setConversations(c);
      } catch {
        // ignore
      }
      return msg;
    } catch (e: any) {
      setError(e?.message ?? 'Falha ao enviar mensagem');
      throw e;
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  // Realtime subscriptions (only when Supabase is configured)
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const supabase = getSupabaseClient();
    const channel = supabase.channel('eros-realtime');

    // Leads updates
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'eros_leads' },
      () => {
        void erosService.listLeads().then(setLeads).catch(() => {});
      }
    );

    // Conversations updates
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'eros_conversations' },
      () => {
        void erosService.listConversations().then(setConversations).catch(() => {});
      }
    );

    // Messages updates: refresh current thread and conversations list
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'eros_messages' },
      (payload) => {
        const row: any = payload.new || payload.old;
        const conversationId = row?.conversation_id as string | undefined;
        if (conversationId) {
          void erosService
            .listMessages(conversationId)
            .then((msgs) => {
              setMessagesByConversation((prev) => ({ ...prev, [conversationId]: msgs }));
            })
            .catch(() => {});
        }
        void erosService.listConversations().then(setConversations).catch(() => {});
      }
    );

    // Pipeline updates
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'eros_pipeline' },
      () => {
        void erosService.listPipeline().then(setPipeline).catch(() => {});
      }
    );

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') setError((e) => e ?? 'Realtime: falha ao conectar');
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return {
    // estado
    leads,
    conversations,
    pipeline,
    isLoading,
    error,
    needsSetup,

    // seleção
    selectedConversation,
    selectedConversationId,
    messages: selectedConversationId ? (messagesByConversation[selectedConversationId] ?? []) : [],

    // ações
    reload: loadBase,
    selectConversation,
    sendMessage,
  };
}
