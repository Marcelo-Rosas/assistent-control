import React, { useMemo } from 'react';
import { Heart } from 'lucide-react';
import { useEros } from '../../hooks/useEros';
import { ErosPipelineStage } from '../../types';

const STAGES: { id: ErosPipelineStage; title: string }[] = [
  { id: 'new', title: 'Novo' },
  { id: 'qualifying', title: 'Qualificando' },
  { id: 'qualified', title: 'Qualificado' },
  { id: 'call', title: 'Call' },
  { id: 'proposal', title: 'Proposta' },
  { id: 'converted', title: 'Convertido' },
];

export const ErosKanban: React.FC = () => {
  const { pipeline, leads, isLoading, error, needsSetup } = useEros();

  const byStage = useMemo(() => {
    const map = new Map<ErosPipelineStage, { id: string; leadId: string; pos: number }[]>();
    for (const s of STAGES) map.set(s.id, []);
    for (const item of pipeline) {
      const arr = map.get(item.stage) ?? [];
      arr.push({ id: item.id, leadId: item.lead_id, pos: item.position });
      map.set(item.stage, arr);
    }
    for (const s of STAGES) {
      const arr = map.get(s.id) ?? [];
      arr.sort((a, b) => a.pos - b.pos);
      map.set(s.id, arr);
    }
    return map;
  }, [pipeline]);

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="p-6 pb-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-50">Eros • Kanban</h1>
            <p className="text-xs text-slate-400">Pipeline social (read-only por enquanto).</p>
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

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 min-w-[1000px] lg:min-w-0">
          {STAGES.map((s) => {
            const items = byStage.get(s.id) ?? [];
            return (
              <div
                key={s.id}
                className="rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl overflow-hidden"
              >
                <div className="px-3 py-3 border-b border-slate-800/70 flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-100">{s.title}</div>
                  <div className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-900/60 border border-slate-800/70 text-slate-300">
                    {isLoading ? '—' : items.length}
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  {items.map((it) => {
                    const lead = leads.find((l) => l.id === it.leadId);
                    return (
                      <div
                        key={it.id}
                        className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/70 hover:bg-slate-900/55 transition-colors"
                      >
                        <div className="text-sm font-semibold text-slate-100 truncate">{lead?.name || '—'}</div>
                        <div className="mt-1 text-[11px] text-slate-400 truncate">
                          {lead ? `${lead.channel} • ${lead.classification.toUpperCase()} • ${lead.score}` : '—'}
                        </div>
                      </div>
                    );
                  })}
                  {!isLoading && items.length === 0 && (
                    <div className="text-xs text-slate-500">Sem itens</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

