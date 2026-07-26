import React, { useEffect, useState } from 'react';
import { useRoles } from '../context/RoleContext';
import { erosService, LlmProviderOption } from '../services/erosService';

const LLM_OPTIONS: Array<{ value: LlmProviderOption; label: string }> = [
  { value: 'sakana', label: 'Sakana' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
];

/** LLM + auto-reply controls (was on ErosLayout; now global AppLayout). */
export const PipelineLlmBar: React.FC = () => {
  const { hasPermission, currentRole } = useRoles();
  const canToggle = currentRole === 'admin' || hasPermission('access_eros');
  const [llmProvider, setLlmProvider] = useState<LlmProviderOption>('sakana');
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [autoReply, setAutoReply] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);

  useEffect(() => {
    if (!canToggle) return;
    let cancelled = false;
    void erosService
      .getLlmProvider()
      .then((p) => {
        if (!cancelled) setLlmProvider(p);
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
  }, [canToggle]);

  if (!canToggle) return null;

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
    <div className="flex items-center gap-3 flex-wrap justify-end">
      <div className="flex items-center gap-2">
        <label htmlFor="pipeline-llm-provider" className="text-[11px] text-slate-500 whitespace-nowrap">
          LLM
        </label>
        <select
          id="pipeline-llm-provider"
          value={llmProvider}
          disabled={llmSaving}
          onChange={(e) => void handleLlmChange(e.target.value as LlmProviderOption)}
          className="text-xs bg-slate-900 border border-slate-700 text-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-60"
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
          className="rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500/40"
        />
        Auto-reply WA
      </label>
      {(llmSaving || autoSaving) && <span className="text-[10px] text-slate-500">salvando…</span>}
      {llmError && <span className="text-[10px] text-rose-400 max-w-[160px] truncate">{llmError}</span>}
    </div>
  );
};
