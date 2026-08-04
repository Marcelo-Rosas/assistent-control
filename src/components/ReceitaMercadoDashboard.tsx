import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, ChevronRight, Loader2 } from 'lucide-react';

type ReceitaGeoNode = {
  key: string;
  label: string;
  ativos: number;
  entrantes_mes: number;
  baixados_mes: number;
  saldo_mes: number;
  diff_novos: number;
  diff_baixados: number;
  children?: ReceitaGeoNode[];
};

type ReceitaKpisFile = {
  generated_at: string;
  month: string;
  cnae: string;
  totals: {
    ativos: number;
    entrantes_mes: number;
    baixados_mes: number;
    saldo_mes: number;
    diff_novos: number;
    diff_baixados: number;
  };
  by_uf: ReceitaGeoNode[];
};

type MonthsFile = { months: string[]; latest?: string };

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
        {title}
      </div>
      <div className="text-2xl font-bold text-slate-50 mt-1 tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-slate-500 mt-1">{hint}</div> : null}
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR');
}

export const ReceitaMercadoDashboard: React.FC = () => {
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>('');
  const [data, setData] = useState<ReceitaKpisFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ufKey, setUfKey] = useState<string | null>(null);
  const [cityKey, setCityKey] = useState<string | null>(null);

  const loadMonths = useCallback(async () => {
    const r = await fetch('/receita/months.json');
    if (!r.ok) throw new Error('months.json ausente — rode npm run scout:receita-kpis');
    const j = (await r.json()) as MonthsFile | string[];
    const list = Array.isArray(j) ? j : j.months || [];
    const latest = Array.isArray(j) ? list[list.length - 1] : j.latest || list[list.length - 1];
    setMonths(list);
    setMonth((m) => m || latest || '');
  }, []);

  const loadKpis = useCallback(async (m: string) => {
    if (!m) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/receita/kpis-${m}.json`);
      if (!r.ok) {
        const latest = await fetch('/receita/kpis-latest.json');
        if (!latest.ok) throw new Error(`KPI ${m} não encontrado`);
        setData((await latest.json()) as ReceitaKpisFile);
      } else {
        setData((await r.json()) as ReceitaKpisFile);
      }
      setUfKey(null);
      setCityKey(null);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMonths()
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [loadMonths]);

  useEffect(() => {
    if (month) void loadKpis(month);
  }, [month, loadKpis]);

  const ufNode = useMemo(
    () => data?.by_uf.find((u) => u.key === ufKey) ?? null,
    [data, ufKey],
  );
  const cityNode = useMemo(
    () => ufNode?.children?.find((c) => c.key === cityKey) ?? null,
    [ufNode, cityKey],
  );

  const tableRows: ReceitaGeoNode[] = cityNode?.children
    ? cityNode.children
    : ufNode?.children
      ? ufNode.children
      : data?.by_uf ?? [];

  const levelLabel = cityNode ? 'Bairros' : ufNode ? 'Cidades' : 'UFs';

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-50">Receita · CNAE 9313100</h1>
              <p className="text-xs text-slate-400">
                Academias — entrantes, baixados e diff por UF / cidade / bairro
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Mês</label>
            <select
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              disabled={!months.length}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-100 text-sm space-y-2">
            <p>{error}</p>
            <code className="text-xs text-amber-50/80 block">
              npm run scout:receita-kpis -- --month YYYY-MM
            </code>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando KPIs…
          </div>
        )}

        {data && !loading && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <MetricCard title="Ativos" value={fmt(data.totals.ativos)} />
              <MetricCard title="Entrantes mês" value={fmt(data.totals.entrantes_mes)} />
              <MetricCard title="Baixados mês" value={fmt(data.totals.baixados_mes)} />
              <MetricCard
                title="Saldo mês"
                value={fmt(data.totals.saldo_mes)}
                hint="entrantes − baixados"
              />
              <MetricCard title="Diff novos" value={fmt(data.totals.diff_novos)} />
              <MetricCard title="Diff baixados" value={fmt(data.totals.diff_baixados)} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <button
                type="button"
                className="hover:text-cyan-300"
                onClick={() => {
                  setUfKey(null);
                  setCityKey(null);
                }}
              >
                Brasil
              </button>
              {ufNode && (
                <>
                  <ChevronRight className="w-3 h-3" />
                  <button
                    type="button"
                    className="hover:text-cyan-300"
                    onClick={() => setCityKey(null)}
                  >
                    {ufNode.label}
                  </button>
                </>
              )}
              {cityNode && (
                <>
                  <ChevronRight className="w-3 h-3" />
                  <span className="text-slate-200">{cityNode.label}</span>
                </>
              )}
              <span className="ml-auto text-slate-600">
                gerado {new Date(data.generated_at).toLocaleString('pt-BR')} · CNAE{' '}
                {data.cnae}
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold text-slate-200">{levelLabel}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase text-slate-500 bg-slate-950/50">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold">Nome</th>
                      <th className="text-right px-3 py-2 font-semibold">Ativos</th>
                      <th className="text-right px-3 py-2 font-semibold">Entrantes</th>
                      <th className="text-right px-3 py-2 font-semibold">Baixados</th>
                      <th className="text-right px-3 py-2 font-semibold">Saldo</th>
                      <th className="text-right px-3 py-2 font-semibold">Diff+</th>
                      <th className="text-right px-4 py-2 font-semibold">Diff−</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => {
                      const clickable = Boolean(row.children?.length);
                      return (
                        <tr
                          key={row.key}
                          className={`border-t border-slate-800/80 ${
                            clickable
                              ? 'cursor-pointer hover:bg-slate-800/40'
                              : ''
                          }`}
                          onClick={() => {
                            if (!clickable) return;
                            if (!ufKey) {
                              setUfKey(row.key);
                              setCityKey(null);
                            } else if (!cityKey) {
                              setCityKey(row.key);
                            }
                          }}
                        >
                          <td className="px-4 py-2.5 text-slate-100 font-medium">
                            {row.label}
                            {clickable ? (
                              <ChevronRight className="inline w-3.5 h-3.5 ml-1 text-slate-600" />
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">
                            {fmt(row.ativos)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-emerald-400/90">
                            {fmt(row.entrantes_mes)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-rose-400/90">
                            {fmt(row.baixados_mes)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-200">
                            {fmt(row.saldo_mes)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">
                            {fmt(row.diff_novos)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                            {fmt(row.diff_baixados)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReceitaMercadoDashboard;
