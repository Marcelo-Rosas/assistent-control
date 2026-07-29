/**
 * Smoke / unit — filtros RAG (filterByCityPriority + extractQueryFilters + tipos).
 *
 * Run: npm run test:rag-filters
 *
 * Framework: node:test (projeto sem vitest/jest). Imports diretos de _shared.
 * Integração RPC: só se SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY presentes.
 */
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boostByCityPrimary,
  CITY_PRIMARY_BOOST,
  filterByCityPriority,
  type MatchChunkResult,
} from '../supabase/functions/_shared/matchChunks.ts';
import { extractQueryFilters } from '../supabase/functions/_shared/queryFilters.ts';
import type { MatchChunkMeta } from '../src/types/matchChunks.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function chunk(
  id: string,
  meta: MatchChunkResult['meta'],
): MatchChunkResult {
  return {
    chunk_id: id,
    chunk_type: 'gym_modality',
    text: `chunk ${id}`,
    meta,
    section_path: null,
    source_ref: id,
    similarity: 0.8,
    score: 0.8,
  };
}

// ---------------------------------------------------------------------------
// PASSO 1 — filterByCityPriority
// ---------------------------------------------------------------------------
describe('filterByCityPriority', () => {
  it('Caso 1: prioriza meta.cidade=Arujá sobre related-only', () => {
    const primary = chunk('primary-aruja', {
      cidade: 'Arujá',
      municipios_relacionados: ['Guarulhos'],
      nome_academia: 'Gym Arujá',
    });
    const relatedOnly = chunk('related-poa', {
      cidade: 'Poá',
      municipios_relacionados: ['Arujá', 'Itaquaquecetuba'],
      nome_academia: 'Gym Poá',
    });
    const out = filterByCityPriority([relatedOnly, primary], 'Arujá');
    assert.equal(out.length, 1);
    assert.equal(out[0].chunk_id, 'primary-aruja');
  });

  it('Caso 2: fallback exact em municipios_relacionados se sem cidade primária', () => {
    const a = chunk('g-guarulhos', {
      cidade: 'Guarulhos',
      municipios_relacionados: ['Arujá', 'Santa Isabel'],
    });
    const b = chunk('g-poa', {
      cidade: 'Poá',
      municipios_relacionados: ['Itaquaquecetuba'],
    });
    const out = filterByCityPriority([a, b], 'Arujá');
    assert.equal(out.length, 1);
    assert.equal(out[0].chunk_id, 'g-guarulhos');
  });

  it('Caso 3: normalização CI (são paulo === São Paulo)', () => {
    const sp = chunk('sp-1', { cidade: 'São Paulo', municipios_relacionados: [] });
    const out = filterByCityPriority([sp], 'são paulo');
    assert.equal(out.length, 1);
    assert.equal(out[0].chunk_id, 'sp-1');

    const out2 = filterByCityPriority([sp], 'SAO PAULO');
    assert.equal(out2.length, 1);
  });

  it('não faz substring frouxa em related (Arujá ≠ parcial)', () => {
    const bad = chunk('bad', {
      cidade: 'Campinas',
      municipios_relacionados: ['Arujazinho'],
    });
    const out = filterByCityPriority([bad], 'Arujá');
    assert.equal(out.length, 0);
  });
});

describe('boostByCityPrimary', () => {
  it('primary sobe acima de related-only (soft rank)', () => {
    const related = chunk('rel', {
      cidade: 'Poá',
      municipios_relacionados: ['Arujá'],
    });
    related.score = 0.9;
    related.similarity = 0.9;
    const primary = chunk('pri', {
      cidade: 'Arujá',
      municipios_relacionados: [],
    });
    primary.score = 0.85;
    primary.similarity = 0.85;

    const out = boostByCityPrimary([related, primary], 'Arujá');
    assert.equal(out[0].chunk_id, 'pri');
    assert.equal(out[0]._cityBoost, true);
    assert.ok(Math.abs(out[0].score - Math.min(0.85 + CITY_PRIMARY_BOOST, 1)) < 1e-9);
    assert.equal(out[1].chunk_id, 'rel');
    assert.equal(out[1]._cityBoost, false);
    assert.equal(out[1].score, 0.9);
  });

  it('CI + acento: são paulo === São Paulo', () => {
    const sp = chunk('sp', { cidade: 'São Paulo' });
    sp.score = 0.7;
    const out = boostByCityPrimary([sp], 'sao paulo');
    assert.equal(out[0]._cityBoost, true);
    assert.ok(out[0].score > 0.7);
  });

  it('sem municipio → identidade', () => {
    const a = chunk('a', { cidade: 'Santos' });
    a.score = 0.5;
    const out = boostByCityPrimary([a], null);
    assert.equal(out[0].score, 0.5);
    assert.equal(out[0]._cityBoost, false);
  });

  it('score nunca > 1.0', () => {
    const a = chunk('a', { cidade: 'Osasco' });
    a.score = 0.98;
    const out = boostByCityPrimary([a], 'Osasco');
    assert.equal(out[0].score, 1.0);
  });
});

// ---------------------------------------------------------------------------
// PASSO 2 — queryFilters (dataset eval)
// ---------------------------------------------------------------------------
describe('extractQueryFilters', () => {
  it('"Academia de musculação em Arujá"', () => {
    const f = extractQueryFilters('Academia de musculação em Arujá');
    assert.equal(f.municipio, 'Arujá');
    assert.equal(f.modalidade, 'musculacao');
  });

  it('"Pilates em Niterói com GuruPass"', () => {
    const f = extractQueryFilters('Pilates em Niterói com GuruPass');
    assert.equal(f.municipio, 'Niterói');
    assert.equal(f.modalidade, 'pilates');
  });

  it('"Musculação em Santos ou São Vicente" → primeira cidade = Santos', () => {
    const f = extractQueryFilters('Musculação em Santos ou São Vicente');
    assert.equal(f.municipio, 'Santos');
    assert.equal(f.modalidade, 'musculacao');
  });
});

// ---------------------------------------------------------------------------
// PASSO 3 — tipagem MatchChunkMeta (shape runtime + assignability)
// ---------------------------------------------------------------------------
describe('MatchChunkMeta typing', () => {
  it('aceita campos canônicos do contrato', () => {
    const meta: MatchChunkMeta = {
      cidade: 'Arujá',
      municipios_relacionados: ['Guarulhos'],
      modalidade: 'musculacao',
      modalidade_key: 'musculacao',
      bairro: 'Centro',
      bairro_normalizado: 'centro',
      plano_minimo_rank: 2,
      nome_academia: 'Gym X',
    };
    assert.equal(typeof meta.cidade, 'string');
    assert.ok(Array.isArray(meta.municipios_relacionados));
    assert.equal(typeof meta.modalidade, 'string');
    assert.equal(typeof meta.modalidade_key, 'string');
    assert.equal(typeof meta.bairro, 'string');
    assert.equal(typeof meta.bairro_normalizado, 'string');
    assert.equal(typeof meta.plano_minimo_rank, 'number');
    assert.equal(typeof meta.nome_academia, 'string');
  });

  it('src/types/matchChunks.ts declara campos obrigatórios do contrato', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/types/matchChunks.ts'), 'utf8');
    for (const field of [
      'cidade?:',
      'municipios_relacionados?:',
      'modalidade?:',
      'modalidade_key?:',
      'bairro?:',
      'bairro_normalizado?:',
      'plano_minimo_rank?:',
      'nome_academia?:',
    ]) {
      assert.ok(src.includes(field), `missing ${field}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Frontend KnowledgeBase — filtros UI presentes
// ---------------------------------------------------------------------------
describe('KnowledgeBase.tsx UI filters', () => {
  it('tem input município + select modalidade', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/components/knowledge/KnowledgeBase.tsx'),
      'utf8',
    );
    assert.ok(src.includes('filterMunicipio'));
    assert.ok(src.includes('filterModalidade'));
    assert.ok(src.includes('<select'));
    for (const m of ['musculacao', 'pilates', 'yoga', 'boxe', 'jiu_jitsu', 'crossfit']) {
      assert.ok(src.includes(`value="${m}"`), `select missing ${m}`);
    }
    assert.ok(src.includes('municipio: filterMunicipio'));
    assert.ok(src.includes('modalidade: filterModalidade'));
  });
});

// ---------------------------------------------------------------------------
// PASSO 4 — integração RPC (opcional / skip sem credenciais)
// ---------------------------------------------------------------------------
describe('match_chunks RPC smoke (optional)', () => {
  it('filtra match_municipio=Arujá via embedding aleatório', async (t: TestContext) => {
    // load .env.local lightly
    for (const name of ['.env.local', '.env']) {
      const p = path.join(ROOT, name);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const eq = trimmed.indexOf('=');
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
    }

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const groupId =
      process.env.GURUPASS_GROUP_ID || '4d1e2c40-217b-4a39-bc08-f9c3e90fd803';

    if (!url || !key) {
      t.skip('sem SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — skip integração');
      return;
    }

    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url, key);

    // vetor unitário aleatório 1024d (smoke de filtro, não qualidade semântica)
    const embedding = Array.from({ length: 1024 }, () => Math.random() * 2 - 1);

    const { data, error } = await sb.rpc('match_chunks', {
      query_embedding: embedding,
      match_group_id: groupId,
      match_tenant_id: null,
      match_modalidade: 'musculacao',
      match_bairro: null,
      match_plano_rank: null,
      match_municipio: 'Arujá',
      match_k: 10,
      min_similarity: 0.0,
      match_query: 'academia musculação Arujá GuruPass',
    });

    assert.equal(error, null, error?.message);
    const rows = (data || []) as MatchChunkResult[];
    // Com min_sim=0 ainda pode retornar 0 se ANN+filtros estritos; se houver hits, validar cidade
    for (const row of rows) {
      const cidade = typeof row.meta?.cidade === 'string' ? row.meta.cidade : '';
      const muns = Array.isArray(row.meta?.municipios_relacionados)
        ? row.meta.municipios_relacionados
        : [];
      const norm = (s: string) =>
        s
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
      const ok =
        norm(cidade) === norm('Arujá') ||
        muns.some((m) => typeof m === 'string' && norm(m) === norm('Arujá'));
      assert.ok(ok, `hit fora do filtro: cidade=${cidade} muns=${JSON.stringify(muns)}`);
    }

    // pós-RPC priority: se houver primary, related-only some
    const prioritized = filterByCityPriority(rows, 'Arujá');
    for (const row of prioritized) {
      const cidade = typeof row.meta?.cidade === 'string' ? row.meta.cidade : '';
      if (prioritized.some((r) => r.meta?.cidade && normCity(String(r.meta.cidade)) === 'aruja')) {
        assert.equal(normCity(cidade), 'aruja');
      }
    }
  });
});

function normCity(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
