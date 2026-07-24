import React from 'react';
import { Heart, Sparkles } from 'lucide-react';
import { Button } from '../Button';

export const ErosContentQueue: React.FC = () => {
  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-50">Eros • Conteúdo</h1>
              <p className="text-xs text-slate-400">Fila de aprovação e publicação.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 backdrop-blur-xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Gerar novo conteúdo</div>
              <div className="text-xs text-slate-400">
                Próximo passo: Edge Functions <code className="text-slate-200">eros-content-gen</code> e{' '}
                <code className="text-slate-200">eros-publish</code> + tabela <code className="text-slate-200">eros_content</code>.
              </div>
            </div>
            <Button className="gap-2">
              <Sparkles className="w-4 h-4" />
              Gerar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

