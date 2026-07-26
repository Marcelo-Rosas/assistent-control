import React, { useMemo, useState } from 'react';
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
  const { pipeline, leads, isLoading, error, needsSetup, moveLeadStage } = useEros();
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ErosPipelineStage | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

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

  const onMove = async (leadId: string, stage: ErosPipelineStage) => {
    setLocalError(null);
    setBusyLeadId(leadId);
    try {
      await moveLeadStage(leadId, stage);
    } catch (e: any) {
      setLocalError(e?.message ?? 'Falha ao mover');
    } finally {
      setBusyLeadId(null);
      setDraggingLeadId(null);
      setDropTarget(null);
    }
  };

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="p-6 pb-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-50">Pipeline • Kanban</h1>
            <p className="text-xs text-slate-400">Arraste cards ou mude stage no seletor.</p>
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

      {(error || localError) && (
        <div className="px-6 pb-3">
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
            {localError || error}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 min-w-[1000px] lg:min-w-0">
          {STAGES.map((s) => {
            const items = byStage.get(s.id) ?? [];
            const isOver = dropTarget === s.id;
            return (
              <div
                key={s.id}
                className={`rounded-2xl border backdrop-blur-xl overflow-hidden transition-colors ${
                  isOver
                    ? 'border-cyan-500/50 bg-cyan-950/20'
                    : 'border-slate-800/70 bg-slate-950/30'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTarget(s.id);
                }}
                onDragLeave={() => setDropTarget((cur) => (cur === s.id ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  const leadId = e.dataTransfer.getData('text/lead-id') || draggingLeadId;
                  if (leadId) void onMove(leadId, s.id);
                }}
              >
                <div className="px-3 py-3 border-b border-slate-800/70 flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-100">{s.title}</div>
                  <div className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-900/60 border border-slate-800/70 text-slate-300">
                    {isLoading ? '—' : items.length}
                  </div>
                </div>

                <div className="p-3 space-y-2 min-h-[120px]">
                  {items.map((it) => {
                    const lead = leads.find((l) => l.id === it.leadId);
                    const busy = busyLeadId === it.leadId;
                    return (
                      <div
                        key={it.id}
                        draggable={!needsSetup && !busy}
                        onDragStart={(e) => {
                          setDraggingLeadId(it.leadId);
                          e.dataTransfer.setData('text/lead-id', it.leadId);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggingLeadId(null);
                          setDropTarget(null);
                        }}
                        className={`p-3 rounded-xl border transition-colors cursor-grab active:cursor-grabbing ${
                          busy
                            ? 'opacity-60 bg-slate-900/30 border-slate-800/50'
                            : 'bg-slate-900/40 border-slate-800/70 hover:bg-slate-900/55'
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-100 truncate">
                          {lead?.name || '—'}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400 truncate">
                          {lead
                            ? `${lead.channel} • ${lead.classification.toUpperCase()} • ${lead.score}`
                            : '—'}
                        </div>
                        <select
                          disabled={needsSetup || busy}
                          value={s.id}
                          onChange={(e) => void onMove(it.leadId, e.target.value as ErosPipelineStage)}
                          className="mt-2 w-full h-8 text-[11px] rounded-lg bg-slate-950/60 border border-slate-800/70 text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                          aria-label="Mover stage"
                        >
                          {STAGES.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  {!isLoading && items.length === 0 && (
                    <div className="text-xs text-slate-500">Solte aqui</div>
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
