import React, { useEffect, useMemo, useState } from 'react';
import { Heart, Send, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEros } from '../../hooks/useEros';
import { Button } from '../Button';
import { erosService } from '../../services/erosService';

export const ErosChat: React.FC = () => {
  const {
    conversations,
    leads,
    selectedConversationId,
    selectedConversation,
    messages,
    isLoading,
    error,
    needsSetup,
    selectConversation,
    sendMessage,
  } = useEros();

  const [text, setText] = useState('');
  const [spinSuggestion, setSpinSuggestion] = useState<string | null>(null);
  const [spinLoading, setSpinLoading] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedConversationId && conversations.length > 0) {
      void selectConversation(conversations[0].id);
    }
  }, [conversations, selectConversation, selectedConversationId]);

  const lead = useMemo(() => {
    if (!selectedConversation) return null;
    return leads.find((l) => l.id === selectedConversation.lead_id) || null;
  }, [leads, selectedConversation]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedConversation || !lead) return;
    if (!text.trim()) return;
    const content = text.trim();
    setText('');
    await sendMessage({ conversationId: selectedConversation.id, leadId: lead.id, content });
  };

  const handleSpin = async () => {
    if (!selectedConversation || !lead) return;
    setSpinLoading(true);
    setSpinSuggestion(null);
    setSpinError(null);
    try {
      const lastMessages = messages
        .slice(-12)
        .map((m) => ({ direction: m.direction, content: m.content || '' }));
      const { suggestion } = await erosService.spinGenerate({
        conversationId: selectedConversation.id,
        leadId: lead.id,
        lastMessages,
        goal: 'qualificar',
      });
      setSpinSuggestion(suggestion);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha ao gerar SPIN';
      setSpinError(msg);
    } finally {
      setSpinLoading(false);
    }
  };

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="p-6 pb-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-50">Eros • Chat</h1>
            <p className="text-xs text-slate-400">Inbox IG/WhatsApp com contexto SPIN.</p>
          </div>
        </div>

        {!needsSetup && (
          <div className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border bg-emerald-500/10 border-emerald-500/20 text-emerald-300">
            Supabase conectado
          </div>
        )}
      </div>

      {needsSetup && (
        <div className="px-6 pb-3">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-100 text-sm">
            Configure <code className="text-amber-50">VITE_SUPABASE_URL</code> /{' '}
            <code className="text-amber-50">VITE_SUPABASE_ANON_KEY</code>
          </div>
        </div>
      )}

      {error && (
        <div className="px-6 pb-3">
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
            {error}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden px-6 pb-6">
        <div className="h-full grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* list */}
          <div className="lg:col-span-4 rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl overflow-hidden">
            <div className="px-4 py-3 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800/70">
              Conversas
            </div>
            <div className="divide-y divide-slate-800/60 overflow-auto h-full">
              {isLoading && <div className="px-4 py-4 text-sm text-slate-400">Carregando…</div>}
              {!isLoading && !needsSetup && conversations.length === 0 && (
                <div className="px-4 py-6 space-y-3 text-sm text-slate-400">
                  <p>Nenhuma conversa</p>
                  <p className="text-xs">
                    Cadastre via webhook Meta ou insira leads em{' '}
                    <Link to="/eros/contacts" className="text-pink-400 hover:underline">
                      Contatos
                    </Link>
                    .
                  </p>
                </div>
              )}
              {!isLoading &&
                conversations.map((c) => {
                  const l = leads.find((x) => x.id === c.lead_id);
                  const active = c.id === selectedConversationId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => void selectConversation(c.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-900/30 ${
                        active ? 'bg-slate-900/40' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={l?.avatar_url || 'https://placehold.co/64x64/0f172a/94a3b8?text=E'}
                          className="w-10 h-10 rounded-xl border border-slate-700/60 object-cover"
                          alt={l?.name || 'Lead'}
                          loading="lazy"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-100 truncate">{l?.name || '—'}</div>
                            {c.unread_count > 0 && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-500/15 border border-pink-500/25 text-pink-200">
                                {c.unread_count}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {c.last_message_preview || '—'}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* thread */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-800/70 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100 truncate">{lead?.name || 'Selecione uma conversa'}</div>
                <div className="text-[11px] text-slate-400 truncate">
                  {lead ? `${lead.channel} • ${lead.username ? `@${lead.username}` : lead.phone || '—'}` : '—'}
                </div>
              </div>
              <Button
                variant={lead ? 'primary' : 'ghost'}
                size="sm"
                className={`gap-2 ${lead ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 border-0' : ''}`}
                onClick={handleSpin}
                disabled={!lead || spinLoading}
                title={!lead ? 'Selecione uma conversa para gerar SPIN' : 'Gerar sugestão de mensagem (Situation → Need-payoff)'}
              >
                <Sparkles className="w-4 h-4" />
                {spinLoading ? 'Gerando…' : 'SPIN'}
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3">
              {spinError && (
                <div className="rounded-xl p-3 border border-red-500/20 bg-red-500/10 text-red-200 text-sm">
                  {spinError}
                  <p className="text-xs text-red-300/80 mt-1">
                    Confira LLM_PROVIDER + secrets (SAKANA_API_KEY / OLLAMA_BASE_URL / GEMINI_API_KEY) na Edge Function
                    eros-spin-generate.
                  </p>
                </div>
              )}
              {!selectedConversation && conversations.length > 0 && (
                <div className="text-sm text-slate-400">Selecione uma conversa na esquerda e clique em <strong className="text-purple-300">SPIN</strong>.</div>
              )}
              {selectedConversation && spinSuggestion && (
                <div className="rounded-2xl p-3 border border-purple-500/20 bg-purple-500/10 text-slate-100 text-sm">
                  <div className="text-[11px] uppercase tracking-wider text-purple-200/90 font-bold mb-1">
                    Sugestão SPIN
                  </div>
                  <div className="whitespace-pre-wrap break-words">{spinSuggestion}</div>
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setText(spinSuggestion)}
                      className="border-purple-500/20 hover:border-purple-500/40"
                    >
                      Usar no composer
                    </Button>
                  </div>
                </div>
              )}
              {selectedConversation &&
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 border text-sm ${
                        m.direction === 'outgoing'
                          ? 'bg-gradient-to-br from-pink-500/25 to-purple-500/10 border-pink-500/20 text-slate-50'
                          : 'bg-slate-900/40 border-slate-800/70 text-slate-200'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.content || '—'}</div>
                      {m.spin_phase && (
                        <div className="mt-1 text-[10px] text-slate-300/80">
                          SPIN: <span className="font-semibold">{m.spin_phase}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>

            <form onSubmit={handleSend} className="p-3 border-t border-slate-800/70 flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Digite sua mensagem…"
                className="flex-1 h-11 px-3 rounded-xl bg-slate-950/40 border border-slate-800/70 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500/30"
              />
              <Button type="submit" variant="primary" className="gap-2">
                <Send className="w-4 h-4" />
                Enviar
              </Button>
            </form>
          </div>

          {/* context */}
          <div className="lg:col-span-3 rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl overflow-hidden">
            <div className="px-4 py-3 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800/70">
              Contexto
            </div>
            <div className="p-4 space-y-3">
              {!lead && <div className="text-sm text-slate-400">Selecione uma conversa.</div>}
              {lead && (
                <>
                  <div className="flex items-center gap-3">
                    <img
                      src={lead.avatar_url || 'https://placehold.co/64x64/0f172a/94a3b8?text=E'}
                      className="w-12 h-12 rounded-2xl border border-slate-700/60 object-cover"
                      alt={lead.name}
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-100 truncate">{lead.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {lead.username ? `@${lead.username}` : lead.phone || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <InfoPill label="Classificação" value={lead.classification.toUpperCase()} />
                    <InfoPill label="Score" value={String(lead.score)} />
                    <InfoPill label="Status" value={lead.status} />
                    <InfoPill label="Canal" value={lead.channel} />
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                      Tags
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(lead.tags || []).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-900/50 border border-slate-800/70 text-slate-300"
                        >
                          {t}
                        </span>
                      ))}
                      {lead.tags.length === 0 && <span className="text-sm text-slate-400">—</span>}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function InfoPill(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{props.label}</div>
      <div className="text-sm text-slate-100 font-semibold truncate">{props.value}</div>
    </div>
  );
}

