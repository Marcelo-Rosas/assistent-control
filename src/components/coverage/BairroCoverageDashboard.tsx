import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, MapPin, RefreshCw } from 'lucide-react';
import type { BairroCoverageAuditReport, MunicipioCoverageRow } from '../../types/bairroCoverage';

const DATA_URL = '/data/bairro-coverage-audit.json';

function pctCell(value: number | null): string {
  if (value == null) return 'text-slate-500';
  if (value >= 80) return 'text-emerald-400';
  if (value >= 50) return 'text-amber-400';
  return 'text-rose-400';
}

function PctBadge({ value, suffix = '%' }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="text-slate-500">—</span>;
  return <span className={`font-mono text-xs font-semibold ${pctCell(value)}`}>{value}{suffix}</span>;
}

const GAP_LABELS: Record<string, string> = {
  sem_catalogo_oficial: 'Sem catálogo',
  zero_gyms_todos_agregadores: 'Zero gyms',
  wellhub_bairro_gap: 'WH gap bairro',
  wellhub_parse_baixo: 'WH parse baixo',
  totalpass_parse_baixo: 'TP parse baixo',
  gurupass_neighborhood_baixo: 'GP bairro baixo',
};

const AGG_LABELS: Record<'wellhub' | 'totalpass' | 'gurupass', string> = {
  wellhub: 'WH',
  totalpass: 'TP',
  gurupass: 'GP',
};

export const BairroCoverageDashboard: React.FC = () => {
  const [report, setReport] = useState<BairroCoverageAuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uf, setUf] = useState('');
  const [search, setSearch] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as BairroCoverageAuditReport;
      setReport(json);
      if (!uf && json.filter_uf) setUf(json.filter_uf);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar audit');
    } finally {
      setLoading(false);
    }
  }, [uf]);

  useEffect(() => {
    load();
  }, [load]);

  const ufs = useMemo(() => {
    if (!report) return [];
    return [...new Set(report.rows.map((r) => r.uf))].sort();
  }, [report]);

  const filtered = useMemo(() => {
    if (!report) return [];
    return report.rows.filter((r) => {
      if (uf && r.uf !== uf) return false;
      if (onlyGaps && r.gaps.length === 0) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!r.cidade.toLowerCase().includes(q) && !r.municipio_key.includes(q)) return false;
      }
      return true;
    });
  }, [report, uf, search, onlyGaps]);

  const renderExpanded = (row: MunicipioCoverageRow) => {
    if (expanded !== row.municipio_key) return null;
    return (
      <tr>
        <td colSpan={16} className="bg-slate-900/80 p-4 text-xs text-slate-300">
          <div className="grid md:grid-cols-3 gap-4">
            {(['wellhub', 'totalpass', 'gurupass'] as const).map((agg) => {
              const s = row[agg];
              const unresolvable = s.failures.includes('bairro_nao_resolvivel');
              return (
                <div key={agg} className="rounded-lg border border-slate-800 p-3">
                  <div className="font-semibold uppercase text-slate-200 mb-2">{AGG_LABELS[agg]}</div>
                  <div>Gyms: {s.gym_count}</div>
                  <div>Bairros c/ gym: {s.bairros_with_gyms}</div>
                  <div>Parse: <PctBadge value={s.parseable_pct} /></div>
                  <div>Cobertura ref: {unresolvable ? <span className="text-amber-400">N/A (sem bairro)</span> : <PctBadge value={s.coverage_pct} />}</div>
                  {s.missing_bairros.length > 0 && (
                    <div className="mt-2">
                      <div className="text-slate-400 mb-1">Faltando ({s.missing_bairros.length}):</div>
                      <div className="max-h-32 overflow-auto text-slate-500 leading-relaxed">
                        {s.missing_bairros.slice(0, 40).join(' · ')}
                        {s.missing_bairros.length > 40 ? ' …' : ''}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </td>
      </tr>
    );
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Carregando auditoria…
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 text-rose-400">
        {error ?? 'Sem dados'}. Rode <code className="text-slate-200">npm run audit:bairro-coverage</code>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xl font-bold text-slate-50">Cobertura Bairros × Agregadores</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Ref: catálogo oficial → Receita CNAE → união descoberta. Gerado {new Date(report.generated_at).toLocaleString('pt-BR')}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-200 hover:bg-slate-900"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Recarregar JSON
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Municípios', report.summary.municipios_audited],
          ['Catálogo oficial', report.summary.municipios_with_catalog],
          ['Ref Receita', report.summary.municipios_with_receita_ref],
          ['Avg WH / TP / GP cov', `${report.summary.avg_wh_coverage_pct ?? 'N/A'} / ${report.summary.avg_tp_coverage_pct ?? 'N/A'} / ${report.summary.avg_gp_coverage_pct ?? 'N/A'}%`],
        ].map(([label, val]) => (
          <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
            <div className="text-lg font-semibold text-slate-100 mt-1">{val}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2 text-amber-200 text-sm font-semibold mb-2">
          <AlertTriangle className="w-4 h-4" /> Plano 100% — falhas por agregador
        </div>
        <div className="grid md:grid-cols-3 gap-3 text-xs text-slate-300">
          {(['wellhub', 'totalpass', 'gurupass'] as const).map((agg) => (
            <div key={agg}>
              <div className="font-semibold uppercase text-slate-200 mb-1">{agg}</div>
              <ul className="list-disc pl-4 space-y-1">
                {report.plan_100pct_review[agg].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={uf}
          onChange={(e) => setUf(e.target.value)}
          className="h-9 rounded-lg bg-slate-950 border border-slate-800 px-2 text-sm text-slate-200"
        >
          <option value="">Todas UFs</option>
          {ufs.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar município…"
          className="h-9 rounded-lg bg-slate-950 border border-slate-800 px-3 text-sm text-slate-200 min-w-[200px]"
        />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />
          Só com gaps
        </label>
        <span className="text-xs text-slate-500">{filtered.length} municípios</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wide">
            <tr>
              <th className="p-2">Município</th>
              <th className="p-2">UF</th>
              <th className="p-2">Ref</th>
              <th className="p-2">#Ref</th>
              <th className="p-2">WH gyms</th>
              <th className="p-2">WH parse</th>
              <th className="p-2">WH cov</th>
              <th className="p-2">WH tile</th>
              <th className="p-2">TP gyms</th>
              <th className="p-2">TP parse</th>
              <th className="p-2">TP cov</th>
              <th className="p-2">GP gyms</th>
              <th className="p-2">GP parse</th>
              <th className="p-2">GP cov</th>
              <th className="p-2">Gaps</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <React.Fragment key={row.municipio_key}>
                <tr className="border-t border-slate-800/80 hover:bg-slate-900/40">
                  <td className="p-2 text-slate-100 font-medium">{row.cidade}</td>
                  <td className="p-2">{row.uf}</td>
                  <td className="p-2 text-slate-400">{row.reference_source}</td>
                  <td className="p-2 font-mono">{row.reference_bairro_count}</td>
                  <td className="p-2 font-mono">{row.wellhub.gym_count}</td>
                  <td className="p-2"><PctBadge value={row.wellhub.parseable_pct} /></td>
                  <td className="p-2"><PctBadge value={row.wellhub.coverage_pct} /></td>
                  <td className="p-2"><PctBadge value={row.wh_scrape_completion_pct} /></td>
                  <td className="p-2 font-mono">{row.totalpass.gym_count}</td>
                  <td className="p-2"><PctBadge value={row.totalpass.parseable_pct} /></td>
                  <td className="p-2">
                    {row.totalpass.failures.includes('bairro_nao_resolvivel')
                      ? <span className="text-amber-400 font-mono">N/A</span>
                      : <PctBadge value={row.totalpass.coverage_pct} />}
                  </td>
                  <td className="p-2 font-mono">{row.gurupass.gym_count}</td>
                  <td className="p-2"><PctBadge value={row.gurupass.parseable_pct} /></td>
                  <td className="p-2"><PctBadge value={row.gurupass.coverage_pct} /></td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {row.gaps.map((g) => (
                        <span key={g} className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 text-[10px]">
                          {GAP_LABELS[g] ?? g}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="text-cyan-400 hover:underline"
                      onClick={() => setExpanded(expanded === row.municipio_key ? null : row.municipio_key)}
                    >
                      {expanded === row.municipio_key ? '−' : '+'}
                    </button>
                  </td>
                </tr>
                {renderExpanded(row)}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
