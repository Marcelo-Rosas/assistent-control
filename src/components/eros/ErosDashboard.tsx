import React, { useMemo } from 'react';
import { Heart, MessageSquare, Users, Flame, Snowflake, Sun, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEros } from '../../hooks/useEros';

export const ErosDashboard: React.FC = () => {
  const { leads, conversations, isLoading, error, needsSetup } = useEros();

  const counts = useMemo(() => {
    const hot = leads.filter((l) => l.classification === 'hot').length;
    const morno = leads.filter((l) => l.classification === 'morno').length;
    const frio = leads.filter((l) => l.classification === 'frio').length;
    return { hot, morno, frio, total: leads.length };
  }, [leads]);

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
                <Heart className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-xl font-bold text-slate-50">Eros</h1>
                <p className="text-xs text-slate-400">Primeiro agente: prospecção social, chat e pipeline.</p>
              </div>
            </div>
          </div>
          {!needsSetup && (
            <div className="text-right">
              <div className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border bg-emerald-500/10 border-emerald-500/20 text-emerald-300">
                Supabase conectado
              </div>
            </div>
          )}
        </div>

        {needsSetup && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-100 text-sm">
            Configure <code className="text-amber-50">VITE_SUPABASE_URL</code> /{' '}
            <code className="text-amber-50">VITE_SUPABASE_ANON_KEY</code>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
            {error}
          </div>
        )}

        <Link
          to="/eros/chat"
          className="block rounded-2xl border border-purple-500/30 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-transparent p-4 hover:border-purple-500/50 transition-colors group"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-purple-300" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-100 group-hover:text-white">
                  Gerar mensagem SPIN
                </div>
                <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                  O assistente SPIN fica no <strong className="text-slate-300">Chat</strong>: selecione uma conversa e
                  clique no botão <strong className="text-purple-300">SPIN</strong> no topo do thread.
                  {conversations.length === 0 && !isLoading && !needsSetup && ' Nenhuma conversa — cadastre leads ou conecte o webhook Meta.'}
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-purple-300 shrink-0">Abrir Chat →</span>
          </div>
        </Link>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Leads"
            value={isLoading ? '—' : String(counts.total)}
            icon={<Users className="w-4 h-4 text-slate-300" />}
          />
          <MetricCard
            title="Conversas"
            value={isLoading ? '—' : String(conversations.length)}
            icon={<MessageSquare className="w-4 h-4 text-slate-300" />}
          />
          <MetricCard
            title="HOT"
            value={isLoading ? '—' : String(counts.hot)}
            icon={<Flame className="w-4 h-4 text-orange-300" />}
            accent="from-orange-500/20 to-orange-500/0"
          />
          <MetricCard
            title="Morno / Frio"
            value={isLoading ? '—' : `${counts.morno} / ${counts.frio}`}
            icon={
              <div className="flex items-center gap-1">
                <Sun className="w-4 h-4 text-yellow-300" />
                <Snowflake className="w-4 h-4 text-blue-300" />
              </div>
            }
            accent="from-violet-500/20 to-violet-500/0"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl p-5">
            <h2 className="text-sm font-semibold text-slate-100 mb-3">Leads recentes</h2>
            <div className="space-y-2">
              {(leads.slice(0, 6) || []).map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800/60"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={l.avatar_url || 'https://placehold.co/64x64/0f172a/94a3b8?text=E'}
                      className="w-9 h-9 rounded-xl border border-slate-700/60 object-cover"
                      alt={l.name}
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{l.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {l.channel} • {l.username || l.phone || '—'}
                      </div>
                    </div>
                  </div>
                  <span className={badgeClass(l.classification)}>
                    {l.classification.toUpperCase()}
                  </span>
                </div>
              ))}
              {!isLoading && !needsSetup && leads.length === 0 && (
                <div className="text-sm text-slate-400">Nenhum lead</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl p-5">
            <h2 className="text-sm font-semibold text-slate-100 mb-3">Próximos passos</h2>
            <ul className="text-sm text-slate-300 space-y-2">
              <li className="flex gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-pink-500 flex-shrink-0" />
                Defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` e rode `supabase/schema.sql`.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                SPIN: aba <strong className="text-slate-200">Chat</strong> → botão SPIN (requer conversa + secret LLM na Edge Function).
              </li>
              <li className="flex gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-slate-500 flex-shrink-0" />
                Realtime já assina `eros_leads`, `eros_conversations`, `eros_messages`, `eros_pipeline`.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

function MetricCard(props: {
  title: string;
  value: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl p-5">
      <div className={`absolute inset-0 bg-gradient-to-br ${props.accent || 'from-pink-500/10 to-purple-500/0'}`} />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{props.title}</div>
          <div className="mt-1 text-2xl font-bold text-slate-50">{props.value}</div>
        </div>
        <div className="w-9 h-9 rounded-xl bg-slate-900/60 border border-slate-800/70 flex items-center justify-center">
          {props.icon}
        </div>
      </div>
    </div>
  );
}

function badgeClass(classification: string) {
  switch (classification) {
    case 'hot':
      return 'text-[10px] font-bold px-2 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-200';
    case 'frio':
      return 'text-[10px] font-bold px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-200';
    default:
      return 'text-[10px] font-bold px-2 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-200';
  }
}

