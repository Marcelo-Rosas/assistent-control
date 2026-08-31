/**
 * Smoke: 3 queries canônicas no grupo Regulatório via knowledge-ask.
 *
 * Run: npm run smoke:regulatorio-ask
 *
 * Env: SUPABASE_URL | VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REGULATORIO_GROUP_ID
 * Nunca loga a service role key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertRegulatorioGroupId } from './lib/regulatorioLoop.ts';

const ROOT = process.cwd();
const TIMEOUT_MS = 30_000;

function loadDotEnv(filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
  for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const hashIdx = value.search(/\s+#/);
    if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, '.env'));
loadDotEnv(path.join(ROOT, '.env.local'));

const QUERIES = [
  'Qual anuidade/processo CREF 2026?',
  'Academia precisa registro CREF PJ?',
  'Qual CREF cobre UF CE?',
  'Como funciona a CIP digital ou carteira profissional digital e-CIP?',
  'Os novos CREFs de Tocantins Roraima Rondônia Acre e Amapá já recebem registro de academia?',
];

async function ask(
  baseUrl: string,
  key: string,
  groupId: string,
  content: string,
): Promise<{ status: number; detail: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/functions/v1/knowledge-ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        groupId,
        messages: [{ role: 'user', content }],
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string; details?: string };
      if (j.error) detail += ` ${j.error}`;
      if (j.details) detail += ` (${String(j.details).slice(0, 80)})`;
    } catch {
      if (!res.ok) detail += ` ${text.slice(0, 80)}`;
    }
    return { status: res.status, detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, detail: `network: ${msg.slice(0, 120)}` };
  } finally {
    clearTimeout(t);
  }
}

async function main(): Promise<void> {
  const baseUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  const groupRaw = process.env.REGULATORIO_GROUP_ID?.trim() || '';

  if (!baseUrl) {
    console.error('Variável ausente: SUPABASE_URL ou VITE_SUPABASE_URL');
    process.exit(1);
  }
  if (!key) {
    console.error('Variável ausente: SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  let groupId: string;
  try {
    groupId = assertRegulatorioGroupId(groupRaw);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  console.log(`group=${groupId}`);
  console.log('query | status | detail');
  console.log('------|--------|-------');

  let ok = 0;
  for (const q of QUERIES) {
    const r = await ask(baseUrl, key, groupId, q);
    const shortQ = q.length > 48 ? `${q.slice(0, 45)}...` : q;
    console.log(`${shortQ} | ${r.status} | ${r.detail}`);
    if (r.status === 200) ok += 1;
  }

  if (ok !== QUERIES.length) {
    console.error(`FAIL smoke: ${ok}/${QUERIES.length} HTTP 200`);
    process.exit(1);
  }
  console.log(`OK smoke: ${ok}/${QUERIES.length}`);
}

main();
