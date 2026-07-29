import React, { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Heart, LayoutDashboard, MessageSquare, Kanban, Users, Search, FileText, Sparkles, type LucideIcon } from 'lucide-react';
import { useRoles } from '../../context/RoleContext';
import { erosService, LlmProviderOption } from '../../services/erosService';

type ErosTab = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: string;
};

const tabs: ErosTab[] = [
  { to: '/eros', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/eros/chat', label: 'Chat', icon: MessageSquare, badge: 'SPIN' },
  { to: '/eros/kanban', label: 'Pipeline', icon: Kanban },
  { to: '/eros/contacts', label: 'Contatos', icon: Users },
  { to: '/eros/prospection', label: 'Prospecção', icon: Search },
  { to: '/eros/content', label: 'Conteúdo', icon: FileText },
];

const LLM_OPTIONS: Array<{ value: LlmProviderOption; label: string }> = [
  { value: 'sakana', label: 'Sakana (Fugu)' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
];

export const ErosLayout: React.FC = () => {
  const { hasPermission, currentRole } = useRoles();
  const canToggleLlm = currentRole === 'admin' || hasPermission('access_eros');
  const [llmProvider, setLlmProvider] = useState<LlmProviderOption>('sakana');
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [autoReply, setAutoReply] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);

  useEffect(() => {
    if (!canToggleLlm) return;
    let cancelled = false;
    void erosService
      .getLlmProvider()
      .then((provider) => {
        if (!cancelled) setLlmProvider(provider);
      })
      .catch(() => {
        if (!cancelled) setLlmProvider('sakana');
      });
    void erosService
      .getAutoReply()
      .then((enabled) => {
        if (!cancelled) setAutoReply(enabled);
      })
      .catch(() => {
        if (!cancelled) setAutoReply(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canToggleLlm]);

  const handleLlmChange = async (next: LlmProviderOption) => {
    const previous = llmProvider;
    setLlmProvider(next);
    setLlmSaving(true);
    setLlmError(null);
    try {
      await erosService.setLlmProvider(next);
    } catch (e: unknown) {
      setLlmProvider(previous);
      setLlmError(e instanceof Error ? e.message : 'Falha ao salvar LLM');
    } finally {
      setLlmSaving(false);
    }
  };

  const handleAutoReplyChange = async (next: boolean) => {
    const previous = autoReply;
    setAutoReply(next);
    setAutoSaving(true);
    setLlmError(null);
    try {
      await erosService.setAutoReply(next);
    } catch (e: unknown) {
      setAutoReply(previous);
      setLlmError(e instanceof Error ? e.message : 'Falha ao salvar auto-reply');
    } finally {
      setAutoSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 pt-4 pb-0 border-b border-slate-800/60 bg-slate-950/40">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
              <Heart className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-300">Eros</span>
          </div>
          {canToggleLlm && (
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <div className="flex items-center gap-2">
                <label htmlFor="eros-llm-provider" className="text-[11px] text-slate-500 whitespace-nowrap">
                  LLM
                </label>
                <select
                  id="eros-llm-provider"
                  value={llmProvider}
                  disabled={llmSaving}
                  onChange={(e) => void handleLlmChange(e.target.value as LlmProviderOption)}
                  className="text-xs bg-slate-900 border border-slate-700 text-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-pink-500/50 disabled:opacity-60"
                >
                  {LLM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoReply}
                  disabled={autoSaving}
                  onChange={(e) => void handleAutoReplyChange(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-900 text-pink-500 focus:ring-pink-500/40"
                />
                Auto-reply WA
              </label>
              {(llmSaving || autoSaving) && <span className="text-[10px] text-slate-500">salvando…</span>}
              {llmError && <span className="text-[10px] text-rose-400 max-w-[160px] truncate">{llmError}</span>}
            </div>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto pb-px scrollbar-thin">
          {tabs.map(({ to, label, icon: Icon, badge, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest ? rest.end : false}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-pink-500 text-pink-200 bg-slate-900/50'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
                }`
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {badge && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-purple-500/20 border border-purple-500/30 text-[10px] font-bold text-purple-200">
                  <Sparkles className="w-2.5 h-2.5" />
                  {badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
};
