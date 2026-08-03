import { createHash } from 'node:crypto';

export type TriageDecision = 'drop' | 'raw-only' | 'ingest' | 'human-amber';

const DECISIONS = new Set<TriageDecision>([
  'drop',
  'raw-only',
  'ingest',
  'human-amber',
]);

const WELLHUB_UUID_PREFIX = '553fa8d6';
const MAX_URL_LEN = 2048;

export function urlHash(url: string, title: string, date: string): string {
  return createHash('sha256')
    .update(`${url}|${title}|${date}`)
    .digest('hex');
}

export function parseDecision(raw: string): TriageDecision {
  const v = raw.trim() as TriageDecision;
  if (!DECISIONS.has(v)) {
    throw new Error(`decision inválida: ${raw}`);
  }
  return v;
}

export function shouldSkipTick(
  lastTickIso: string | null,
  now: Date,
  minHours = 20,
): boolean {
  if (!lastTickIso) return false;
  const last = Date.parse(lastTickIso);
  if (Number.isNaN(last)) return false;
  const diffH = (now.getTime() - last) / 3_600_000;
  return diffH < minHours;
}

export function buildInboxDoc(
  meta: {
    source_url: string;
    fetched_at: string;
    tema: string;
    decision: TriageDecision;
  },
  body: string,
): string {
  return [
    '---',
    `source_url: ${meta.source_url}`,
    `fetched_at: ${meta.fetched_at}`,
    `tema: ${meta.tema}`,
    `decision: ${meta.decision}`,
    '---',
    '',
    body.trim(),
    '',
  ].join('\n');
}

export function assertIsoDate(date: string): string {
  const trimmed = date.trim();
  // Reject locale slash forms (ambiguous); require ISO-ish.
  if (/[\/]/.test(trimmed)) {
    throw new Error(`data inválida: ${date}`);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const t = Date.parse(trimmed.slice(0, 10));
    if (Number.isNaN(t)) throw new Error(`data inválida: ${date}`);
    return trimmed;
  }
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) throw new Error(`data inválida: ${date}`);
  return trimmed;
}

export function assertAllowlistedUrl(url: string): string {
  if (url.length > MAX_URL_LEN) {
    throw new Error('URL excede 2048 chars');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL inválida: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`protocolo inválido: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  const ok =
    host === 'confef.org.br' ||
    host.endsWith('.confef.org.br') ||
    /cref/i.test(host);
  if (!ok) throw new Error(`URL fora allowlist CONFEF/CREF: ${host}`);
  return parsed.toString();
}

export function assertRegulatorioGroupId(id: string): string {
  const v = id.trim();
  if (!v) throw new Error('REGULATORIO_GROUP_ID vazio');
  if (v.toLowerCase().startsWith(WELLHUB_UUID_PREFIX)) {
    throw new Error('REGULATORIO_GROUP_ID inválido (parece Wellhub)');
  }
  return v;
}

export function extractLastTickIso(stateMarkdown: string): string | null {
  const section = stateMarkdown.match(
    /##\s*last_tick\b([\s\S]*?)(?=\n##\s|\n*$)/i,
  );
  const block = section?.[1] ?? stateMarkdown;
  const m = block.match(/\*\*ISO:\*\*\s*(.+)/i);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw || /nunca/i.test(raw) || raw === '—' || raw === '-') return null;
  const cleaned = raw.replace(/^_+|_+$/g, '').replace(/[*_`]/g, '').trim();
  if (!cleaned || /nunca/i.test(cleaned)) return null;
  if (Number.isNaN(Date.parse(cleaned))) return null;
  return cleaned;
}

export type TickPatch = {
  iso: string;
  result: string;
  ingestCount: number;
  amberCount: number;
  decisionLine?: string;
  urlSeenLine?: string;
};

export function appendTickToState(
  stateMarkdown: string,
  tick: TickPatch,
): string {
  let out = stateMarkdown;

  out = out.replace(
    /(##\s*last_tick\b[\s\S]*?\*\*ISO:\*\*\s*)(.+)/i,
    `$1${tick.iso}`,
  );
  out = out.replace(
    /(##\s*last_tick\b[\s\S]*?\*\*Resultado:\*\*\s*)(.+)/i,
    `$1${tick.result}`,
  );
  out = out.replace(
    /(##\s*last_tick\b[\s\S]*?\*\*ingest_count:\*\*\s*)(.+)/i,
    `$1${tick.ingestCount}`,
  );
  out = out.replace(
    /(##\s*last_tick\b[\s\S]*?\*\*amber_count:\*\*\s*)(.+)/i,
    `$1${tick.amberCount}`,
  );

  if (tick.decisionLine) {
    out = appendUnderHeading(
      out,
      '## decisions (ticks recentes)',
      tick.decisionLine,
    );
  }
  if (tick.urlSeenLine) {
    out = appendUnderHeading(out, '## urls_seen', tick.urlSeenLine);
  }

  return out;
}

function appendUnderHeading(
  markdown: string,
  heading: string,
  line: string,
): string {
  const re = new RegExp(
    `(${escapeRegExp(heading)}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`,
    'i',
  );
  const m = markdown.match(re);
  if (!m) {
    return `${markdown.trimEnd()}\n\n${heading}\n\n${line}\n`;
  }
  let body = m[2];
  if (/_\(vazio\)_/.test(body)) {
    body = body.replace(/_\(vazio\)_\s*/g, '');
  }
  const nextBody = `${body.trimEnd()}\n\n${line}\n`;
  return markdown.replace(re, `${m[1]}${nextBody}`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
