import React, { useMemo, useState } from 'react';
import { Filter, Heart, Search } from 'lucide-react';
import { useEros } from '../../hooks/useEros';
import { ErosClassification } from '../../types';

export const ErosContacts: React.FC = () => {
  const { leads, isLoading, error, needsSetup } = useEros();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ErosClassification | 'all'>('all');

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (filter !== 'all' && l.classification !== filter) return false;
      if (!query) return true;
      return (
        l.name.toLowerCase().includes(query) ||
        (l.username || '').toLowerCase().includes(query) ||
        (l.phone || '').toLowerCase().includes(query)
      );
    });
  }, [leads, q, filter]);

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-50">Eros • Leads</h1>
              <p className="text-xs text-slate-400">Lista de leads sociais (IG/WhatsApp).</p>
            </div>
          </div>

          {!needsSetup && (
            <div className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border bg-emerald-500/10 border-emerald-500/20 text-emerald-300">
              Supabase conectado
            </div>
          )}
        </div>

        {needsSetup && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-100 text-sm">
            Configure <code className="text-amber-50">VITE_SUPABASE_URL</code> /{' '}
            <code className="text-amber-50">VITE_SUPABASE_ANON_KEY</code>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome, @, telefone..."
              className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-950/40 border border-slate-800/70 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500/30"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-950/40 border border-slate-800/70 text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            >
              <option value="all">Todos</option>
              <option value="hot">HOT</option>
              <option value="morno">Morno</option>
              <option value="frio">Frio</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-0 px-4 py-3 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800/70">
            <div className="col-span-5">Lead</div>
            <div className="col-span-2">Canal</div>
            <div className="col-span-2">Classificação</div>
            <div className="col-span-1 text-right">Score</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          <div className="divide-y divide-slate-800/60">
            {isLoading && (
              <div className="px-4 py-4 text-sm text-slate-400">Carregando…</div>
            )}
            {!isLoading && !needsSetup && filtered.length === 0 && (
              <div className="px-4 py-4 text-sm text-slate-400">
                {leads.length === 0 ? 'Nenhum lead' : 'Nenhum lead encontrado.'}
              </div>
            )}
            {!isLoading &&
              filtered.map((l) => (
                <div key={l.id} className="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-900/30">
                  <div className="col-span-5 flex items-center gap-3 min-w-0">
                    <img
                      src={l.avatar_url || 'https://placehold.co/64x64/0f172a/94a3b8?text=E'}
                      className="w-9 h-9 rounded-xl border border-slate-700/60 object-cover"
                      alt={l.name}
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{l.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">{l.username ? `@${l.username}` : l.phone || '—'}</div>
                    </div>
                  </div>
                  <div className="col-span-2 text-sm text-slate-300 capitalize">{l.channel}</div>
                  <div className="col-span-2">
                    <span className={badgeClass(l.classification)}>{l.classification.toUpperCase()}</span>
                  </div>
                  <div className="col-span-1 text-sm text-slate-200 text-right">{l.score}</div>
                  <div className="col-span-2 text-sm text-slate-300 text-right">{l.status}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

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

