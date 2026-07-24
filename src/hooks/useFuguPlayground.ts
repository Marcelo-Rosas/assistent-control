import { useCallback, useRef, useState } from 'react';
import {
  FuguModel,
  ReasoningEffort,
  PlaygroundUsage,
  invokeFuguPlayground,
} from '../services/fuguPlaygroundService';

export type ChatBubble = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  usage?: PlaygroundUsage;
};

export function useFuguPlayground() {
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModelState] = useState<FuguModel>('fugu');
  const [reasoningEffort, setEffortState] = useState<ReasoningEffort>('high');
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [usage, setUsage] = useState<PlaygroundUsage | null>(null);
  const abortRef = useRef(false);

  const setModel = (m: FuguModel) => {
    setModelState(m);
    if (m !== 'fugu-ultra' && reasoningEffort === 'max') setEffortState('high');
  };

  const setReasoningEffort = (e: ReasoningEffort) => {
    if (e === 'max' && model !== 'fugu-ultra') return;
    setEffortState(e);
  };

  const toggleWebSearch = () => setEnableWebSearch((v) => !v);

  const clear = () => {
    setMessages([]);
    setError(null);
    setUsage(null);
  };

  const stop = () => {
    abortRef.current = true;
  };

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      abortRef.current = false;
      setError(null);
      const userMsg: ChatBubble = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
      const next = [...messages, userMsg];
      setMessages(next);
      setIsLoading(true);

      try {
        const payload = next.map((m) => ({ role: m.role, content: m.content }));
        const result = await invokeFuguPlayground({
          messages: payload,
          model,
          reasoning_effort: reasoningEffort,
          web_search: enableWebSearch,
        });
        if (abortRef.current) return;
        setUsage(result.usage);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: result.text,
            usage: result.usage,
          },
        ]);
      } catch (e) {
        if (!abortRef.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, model, reasoningEffort, enableWebSearch],
  );

  return {
    messages,
    isLoading,
    error,
    model,
    reasoningEffort,
    enableWebSearch,
    usage,
    send,
    setModel,
    setReasoningEffort,
    toggleWebSearch,
    clear,
    stop,
  };
}
