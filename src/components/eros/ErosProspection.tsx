import React from 'react';
import { Heart, Search, Sparkles } from 'lucide-react';
import { Button } from '../Button';

export const ErosProspection: React.FC = () => {
  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-50">Pipeline • Prospecção</h1>
              <p className="text-xs text-slate-400">Busca e análise de perfis no Instagram.</p>
            </div>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-200">
            em breve
          </span>
        </div>

        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl p-5 opacity-70">
          <div className="text-sm font-semibold text-slate-100 mb-3">Pesquisar perfil</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                disabled
                placeholder="Ex: overallgymbatel"
                className="w-full h-11 pl-10 pr-3 rounded-xl bg-slate-950/40 border border-slate-800/70 text-slate-200 placeholder:text-slate-500 disabled:cursor-not-allowed"
              />
            </div>
            <Button className="gap-2" disabled title="Edge eros-prospect ainda não ligada">
              <Sparkles className="w-4 h-4" />
              Analisar
            </Button>
          </div>
          <div className="mt-3 text-xs text-slate-400">
            Próximo passo: Edge <code className="text-slate-200">eros-prospect</code> + tabela{' '}
            <code className="text-slate-200">eros_prospects</code>.
          </div>
        </div>
      </div>
    </div>
  );
};
