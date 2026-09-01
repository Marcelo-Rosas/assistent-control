/**
 * Ingestão GuruPass → eros_knowledge_chunks (group GURUPASS_GROUP_ID).
 * Fonte default: data/processed/gurupass-normalized.json (array raiz).
 * Também aceita wrapper { data:[...] } (ex: gurupass-brasil-all.json).
 *
 * 8.8MB cabe na RAM → parse direto (sem stream-json).
 * DEFAULT = DRY-RUN (não escreve). Use --apply para gravar.
 *
 *   npx tsx scripts/ingest-gurupass.ts                 # dry-run
 *   npx tsx scripts/ingest-gurupass.ts --apply         # grava
 *   GP_FILE=data/raw/Agregadores/gurupass-brasil-all.json npx tsx scripts/ingest-gurupass.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const FILE = process.env.GP_FILE ?? 'data/processed/gurupass-normalized.json';
const APPLY = process.argv.includes('--apply');
const BATCH = 50;

function loadDotEnv(filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
  const raw = fs.readFileSync(filePath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
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

const GROUP_ID = process.env.GURUPASS_GROUP_ID?.trim() || '';
if (!GROUP_ID) {
  console.error('❌ GURUPASS_GROUP_ID não definido no .env / .env.local');
  process.exit(1);
}

const hash = (...p: unknown[]) =>
  createHash('sha256').update(p.map(String).join('|')).digest('hex');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const firstStr = (...v: unknown[]): string => {
  for (const x of v) if (typeof x === 'string' && x.trim()) return x.trim();
  return '';
};
const firstNum = (...v: unknown[]): number | null => {
  for (const x of v) if (typeof x === 'number' && isFinite(x)) return x;
  return null;
};

type Item = Record<string, unknown>;

function resolveItems(raw: unknown): Item[] {
  if (Array.isArray(raw)) return raw as Item[];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as Item[];
    if (Array.isArray(o.academias)) return o.academias as Item[];
    if (Array.isArray(o.items)) return o.items as Item[];
  }
  return [];
}

/** Modalidades: brasil-all usa modalities/tags; normalized usa modalidades_extraidas[].nome */
function resolveModalities(item: Item): string[] {
  const fromMods = arr(item.modalities);
  if (fromMods.length) return fromMods.map(String);
  const fromTags = arr(item.tags);
  if (fromTags.length) return fromTags.map(String);
  const extracted = arr(item.modalidades_extraidas);
  if (extracted.length) {
    return extracted
      .map((m) => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object') {
          const nome = (m as Record<string, unknown>).nome;
          return typeof nome === 'string' ? nome : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  const lowest = item.lowestPrice as Record<string, unknown> | undefined;
  const lowest2 = item.lowest_price as Record<string, unknown> | undefined;
  const lowestName = firstStr(lowest?.name, lowest2?.name);
  if (lowestName) return [lowestName];
  return ['academia_geral'];
}

function buildChunks(item: Item): { chunk: Record<string, unknown>; synthetic: boolean }[] {
  const gid = firstStr(
    item.id_externo,
    item.id,
    item.gurupass_id,
    item.external_id,
    item._id,
  );
  const synthetic = !gid;
  const stableId =
    gid ||
    hash(
      'syn',
      firstStr(item.name, item.nome),
      firstStr(item.city, item.cidade),
      firstStr(item.neighborhood, item.bairro),
    );

  const cidade = firstStr(item.city, item.cidade, item.municipio);
  const uf = firstStr(item.uf, item.state);
  const bairro = firstStr(item.neighborhood, item.bairro);
  const endereco = firstStr(
    item.fullAddres,
    item.fullAddress,
    item.address,
    item.endereco,
  );
  const nome = firstStr(item.name, item.nome, item.title);

  const munsRaw = arr(item.municipios_busca ?? item.municipios_relacionados);
  const municipios = munsRaw.length
    ? munsRaw.map(String)
    : cidade
      ? [cidade]
      : [];

  let mods = resolveModalities(item);
  mods = [...new Set(mods.map((m) => String(m).trim()).filter(Boolean))];

  const lowestObj = (item.lowestPrice ?? item.lowest_price) as
    | Record<string, unknown>
    | undefined;
  const lowest = firstNum(
    item.creditos_minimos,
    lowestObj?.lowerPrice,
    lowestObj?.lower_price,
  );
  const lowestName = firstStr(lowestObj?.name, item.plano_minimo);

  const prods = arr(item.products);
  const cents = prods.length
    ? Math.min(
        ...prods
          .map((p) => {
            const o = p as Record<string, unknown>;
            return firstNum(o.cost_cents, o.final_cost_cents, o.costCents) ?? 1e9;
          })
          .filter((x) => x < 1e9),
      )
    : null;
  const valorBrl = cents != null && isFinite(cents) ? cents / 100 : null;

  const loc = item.location as Record<string, unknown> | undefined;
  const coords = (loc?.coordinates ?? item.coordinates) as unknown;
  const lng = Array.isArray(coords)
    ? firstNum(coords[0])
    : firstNum(item.lng, item.longitude);
  const lat = Array.isArray(coords)
    ? firstNum(coords[1])
    : firstNum(item.lat, item.latitude);

  const tags = arr(item.tags).map(String);
  const opening = (item.openingStatus ?? item.openingStatusInfo) as
    | Record<string, unknown>
    | undefined;
  const aberto = typeof opening?.open === 'boolean' ? opening.open : null;

  const out: { chunk: Record<string, unknown>; synthetic: boolean }[] = [];
  for (const mod of mods) {
    const h = hash(GROUP_ID, 'gurupass', stableId, mod);
    const planoMin =
      lowest != null
        ? `a partir de ${lowest} créditos`
        : firstStr(item.valor_plano_minimo) || 'GuruPass Créditos';
    const text = [
      `Academia: ${nome || '(sem nome)'}`,
      cidade ? `Cidade: ${cidade}${uf ? ' / ' + uf : ''}` : '',
      bairro ? `Bairro: ${bairro}` : '',
      endereco ? `Endereço: ${endereco}` : '',
      `Modalidade: ${mod}`,
      lowest != null
        ? `Plano de entrada: ${lowestName || mod} ${planoMin}`
        : 'Plano: sistema de créditos GuruPass',
      valorBrl != null ? `Valor do crédito neste local: R$ ${valorBrl.toFixed(2)}` : '',
      tags.length ? `Tags: ${tags.join(', ')}` : '',
      aberto === true
        ? 'Status: aberto agora'
        : aberto === false
          ? 'Status: fechado no momento'
          : '',
    ]
      .filter(Boolean)
      .join('\n');

    out.push({
      synthetic,
      chunk: {
        group_id: GROUP_ID,
        chunk_id: `gp-${h.slice(0, 16)}`,
        chunk_type: 'gym_modality',
        text,
        meta: {
          nome_academia: nome,
          cidade,
          uf: uf || null,
          bairro: bairro || null,
          endereco: endereco || null,
          municipios_relacionados: municipios,
          modalidade: String(mod).toLowerCase(),
          modalidade_label: mod,
          plano_minimo: planoMin,
          creditos_minimos: lowest,
          valor_credito_brl: valorBrl,
          tags,
          aberto_agora: aberto,
          location: lat != null && lng != null ? { lat, lng } : null,
          gym_id: gid || `synthetic:${stableId.slice(0, 12)}`,
          aggregator: 'gurupass',
          source_kind: 'gurupass_normalized',
        },
        content_hash: h,
        embedding_model: 'pending',
        embedding_version: '0',
        document_version: new Date().toISOString().slice(0, 10),
        access_level: 'public',
        source_kind: 'gurupass_normalized',
        source_ref: gid || `synthetic:${stableId.slice(0, 12)}`,
      },
    });
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`📄 Lendo ${FILE} (parse direto, ${APPLY ? 'APPLY' : 'DRY-RUN'})…`);
  const filePath = path.isAbsolute(FILE) ? FILE : path.join(ROOT, FILE);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const items = resolveItems(raw);
  if (!items.length) {
    console.error('❌ Nenhum item encontrado (nem array raiz nem .data/.academias/.items).');
    process.exit(1);
  }
  console.log(
    `   itens=${items.length} · wrapper=${Array.isArray(raw) ? 'não (array raiz)' : 'sim'}`,
  );

  console.log('\n🔑 Chaves do 1º item:');
  console.log('   ' + Object.keys(items[0]).join(', '));

  const all: Record<string, unknown>[] = [];
  let synthetic = 0;
  for (const it of items) {
    for (const { chunk, synthetic: syn } of buildChunks(it)) {
      all.push(chunk);
      if (syn) synthetic++;
    }
  }

  console.log(
    `\n✂️  chunks=${all.length} · gym_id sintéticos=${synthetic} (sem id estável → hash por nome+cidade)`,
  );
  if (synthetic > items.length * 0.5) {
    console.warn(
      '⚠️  >50% dos itens sem id estável. Confira as chaves acima (procure id_externo/id/gurupass_id).',
    );
  }

  console.log('\n🧪 Chunk de exemplo (validar texto + meta visualmente):');
  console.log(JSON.stringify(all[0], null, 2));

  if (!APPLY) {
    console.log(
      '\n🛑 DRY-RUN: nada foi gravado. Se o schema/chunk estiverem OK → rode com --apply',
    );
    return;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let ok = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const { error } = await supabase
      .from('eros_knowledge_chunks')
      .upsert(batch, { onConflict: 'group_id,content_hash' });
    if (error) {
      console.error(`❌ batch ${i / BATCH + 1}: ${error.message}`);
      process.exit(1);
    }
    ok += batch.length;
    process.stdout.write(`\r✅ upsert ${ok}/${all.length}`);
  }
  process.stdout.write('\n');

  const { count } = await supabase
    .from('eros_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', GROUP_ID);
  await supabase
    .from('eros_knowledge_agents')
    .update({
      chunk_count: count ?? all.length,
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', GROUP_ID);
  console.log(
    `\n🎉 ${ok} chunks (pending). chunk_count no agente=${count}. Rode: npm run embed:gurupass`,
  );
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
