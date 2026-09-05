import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cepCacheKey,
  disambiguateViaCepResults,
  extractCepFromText,
  isCepGenerico,
  buildLogradouroSearchQueries,
  lookupBairroFromCep,
  numeroMatchesComplemento,
  normalizeCep,
  refineCepViaLogradouro,
  type LookupFetch,
  type ViaCepAddressHit,
} from './tpCepResolver.ts';

describe('tpCepResolver', () => {
  it('normalizeCep aceita com hífen e rejeita inválidos', () => {
    assert.equal(normalizeCep('02017-011'), '02017011');
    assert.equal(normalizeCep('02017011'), '02017011');
    assert.equal(normalizeCep('123'), null);
    assert.equal(normalizeCep('00000000'), null);
  });

  it('extractCepFromText pega CEP em endereço completo', () => {
    assert.equal(
      extractCepFromText('R Alfredo Pujol, 1117, Santana, São Paulo, SP, 02017-011'),
      '02017011',
    );
    assert.equal(extractCepFromText('sem cep aqui'), null);
  });

  it('cepCacheKey normaliza', () => {
    assert.equal(cepCacheKey('02017-011'), 'cep:02017011');
  });

  it('lookupBairroFromCep usa cache hit', async () => {
    const cache = {
      'cep:02017011': {
        cep: '02017011',
        bairro: 'Santana',
        bairro_slug: 'santana',
        localidade: 'São Paulo',
        uf: 'SP',
        logradouro: 'Rua Alfredo Pujol',
        provider: 'viacep' as const,
        resolved_at: '2026-01-01T00:00:00.000Z',
      },
    };
    const r = await lookupBairroFromCep('02017-011', { cache, skipNetwork: true });
    assert.equal(r?.bairro, 'Santana');
    assert.equal(r?.cep, '02017011');
  });

  it('lookupBairroFromCep ViaCEP mock', async () => {
    const mockFetch: LookupFetch = async (url) => {
      assert.match(String(url), /viacep\.com\.br\/ws\/02017011/);
      return new Response(
        JSON.stringify({
          cep: '02017-011',
          bairro: 'Santana',
          localidade: 'São Paulo',
          uf: 'SP',
          logradouro: 'Rua Alfredo Pujol',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const cache: Record<string, unknown> = {};
    const r = await lookupBairroFromCep('02017011', {
      cache: cache as never,
      fetch: mockFetch,
    });
    assert.equal(r?.bairro, 'Santana');
    assert.equal(r?.provider, 'viacep');
    assert.ok('cep:02017011' in cache);
  });

  it('lookupBairroFromCep fallback BrasilAPI quando ViaCEP erro', async () => {
    const mockFetch: LookupFetch = async (url) => {
      const u = String(url);
      if (u.includes('viacep')) {
        return new Response(JSON.stringify({ erro: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          cep: '02017011',
          neighborhood: 'Santana',
          city: 'São Paulo',
          state: 'SP',
          street: 'Rua Alfredo Pujol',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const r = await lookupBairroFromCep('02017011', { fetch: mockFetch });
    assert.equal(r?.bairro, 'Santana');
    assert.equal(r?.provider, 'brasilapi');
  });

  it('lookupBairroFromCep faz fallback BrasilAPI quando ViaCEP LANÇA (5xx)', async () => {
    const mockFetch: LookupFetch = async (url) => {
      const u = String(url);
      if (u.includes('viacep')) {
        return new Response('erro', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          cep: '02017011',
          neighborhood: 'Santana',
          city: 'São Paulo',
          state: 'SP',
          street: 'Rua Alfredo Pujol',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const r = await lookupBairroFromCep('02017011', { fetch: mockFetch });
    assert.equal(r?.bairro, 'Santana');
    assert.equal(r?.provider, 'brasilapi');
  });

  it('lookupBairroFromCep NÃO cacheia erro retryável (429) e faz rethrow', async () => {
    const mockFetch: LookupFetch = async () => new Response('rate limit', { status: 429 });
    const cache: Record<string, never> = {};
    await assert.rejects(
      lookupBairroFromCep('02017011', { fetch: mockFetch, cache: cache as never }),
      /HTTP 429/,
    );
    assert.deepEqual(cache, {}, 'cache não deve ser poluído por erro transitório');
  });

  it('lookupBairroFromCep cacheia negativo quando ambos provedores respondem sem bairro', async () => {
    const mockFetch: LookupFetch = async (url) => {
      const u = String(url);
      if (u.includes('viacep')) {
        return new Response(JSON.stringify({ erro: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    };
    const cache: Record<string, never> = {};
    const r = await lookupBairroFromCep('02017011', { fetch: mockFetch, cache: cache as never });
    assert.equal(r, null);
    assert.deepEqual(Object.values(cache), [{ cep: '02017011', error: 'cep_lookup_fail' }]);
  });

  it('isCepGenerico detecta CEP município -000', () => {
    assert.equal(isCepGenerico('37470-000'), true);
    assert.equal(isCepGenerico('37470959'), false);
    assert.equal(isCepGenerico('02017011'), false);
  });

  it('disambiguateViaCepResults — CEP único ou bairro único', () => {
    const hits: ViaCepAddressHit[] = [
      { cep: '37470-959', bairro: 'Centro', localidade: 'São Lourenço', uf: 'MG' },
      { cep: '37470-960', bairro: 'Centro', localidade: 'São Lourenço', uf: 'MG' },
    ];
    assert.equal(disambiguateViaCepResults(hits), '37470959');
    assert.equal(disambiguateViaCepResults([hits[0]!]), '37470959');
    assert.equal(
      disambiguateViaCepResults([
        { cep: '37470-959', bairro: 'Centro', uf: 'MG' },
        { cep: '37470-100', bairro: 'Morro Chico', uf: 'MG' },
      ]),
      null,
    );
  });

  it('numeroMatchesComplemento usa faixa/paridade, não substring', () => {
    // Regressão R1: '12' NÃO pode casar dentro de '1200'.
    assert.equal(numeroMatchesComplemento('de 1200 a 1400', 12), false);
    assert.equal(numeroMatchesComplemento('de 1200 a 1400', 1300), true);
    assert.equal(numeroMatchesComplemento('ate 500', 250), true);
    assert.equal(numeroMatchesComplemento('ate 500', 600), false);
    assert.equal(numeroMatchesComplemento('de 200 ao fim', 5000), true);
    assert.equal(numeroMatchesComplemento('de 200 ao fim', 100), false);
    // Paridade (já sem acento via normalizeForMatch).
    assert.equal(numeroMatchesComplemento('de 1 a 100 - lado par', 3), false);
    assert.equal(numeroMatchesComplemento('de 1 a 100 - lado par', 4), true);
    assert.equal(numeroMatchesComplemento('de 1 a 100 - lado impar', 4), false);
    // Número único → igualdade exata; vazio → false.
    assert.equal(numeroMatchesComplemento('1234', 1234), true);
    assert.equal(numeroMatchesComplemento('1234', 12), false);
    assert.equal(numeroMatchesComplemento('', 12), false);
  });

  it('disambiguateViaCepResults escolhe CEP certo pelo número (faixa)', () => {
    const hits: ViaCepAddressHit[] = [
      { cep: '01000-001', bairro: 'Bairro A', uf: 'SP', complemento: 'de 1 a 100' },
      { cep: '02000-002', bairro: 'Bairro B', uf: 'SP', complemento: 'de 1200 a 1400' },
    ];
    // numero=12 cai só na faixa de A; substring antigo casaria '1200' de B também.
    assert.equal(disambiguateViaCepResults(hits, '12'), '01000001');
    // numero=1300 cai só na faixa de B.
    assert.equal(disambiguateViaCepResults(hits, '1300'), '02000002');
  });

  it('buildLogradouroSearchQueries gera parciais ViaCEP', () => {
    const q = buildLogradouroSearchQueries('RUA', 'DR. LOURENCO ZACCARO');
    assert.ok(q.some((s) => s.includes('ZACCARO') || s.includes('Zaccaro') || s.toLowerCase().includes('zaccaro')));
    assert.ok(q.every((s) => s.length >= 3));
  });

  it('disambiguateViaCepResults ignora CEP genérico -000', () => {
    assert.equal(
      disambiguateViaCepResults([
        { cep: '92480-000', bairro: 'Centro', uf: 'RS' },
      ]),
      null,
    );
  });

  it('refineCepViaLogradouro sanitiza DR. sem HTTP 400', async () => {
    const calls: string[] = [];
    const mockFetch: LookupFetch = async (url) => {
      calls.push(String(url));
      const u = String(url);
      if (u.includes('Nova%20Santa%20Rita') && !u.includes('/92480')) {
        return new Response(
          JSON.stringify([{ cep: '92480-970', bairro: 'Centro', uf: 'RS' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (u.includes('/92480970/')) {
        return new Response(
          JSON.stringify({ cep: '92480-970', bairro: 'Centro', localidade: 'Nova Santa Rita', uf: 'RS' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ erro: true }), { status: 200 });
    };

    const refined = await refineCepViaLogradouro(
      {
        cep_rf: '92480000',
        uf: 'RS',
        municipio: 'Nova Santa Rita',
        logradouro: 'DR. LOURENCO ZACCARO',
        tipo_logradouro: 'RUA',
        numero: '100',
      },
      { fetch: mockFetch },
    );
    assert.equal(refined.ok, true);
    if (refined.ok) assert.equal(refined.cep, '92480970');
    assert.ok(calls.some((u) => u.includes('Nova%20Santa%20Rita')));
    assert.ok(!calls.some((u) => u.includes('DR.')));
  });

  it('refineCepViaLogradouro F2.2 São Lourenço mock', async () => {
    const mockFetch: LookupFetch = async (url) => {
      const u = String(url);
      if (u.includes('/MG/S%C3%A3o%20Louren%C3%A7o/')) {
        return new Response(
          JSON.stringify([
            { cep: '37470-959', bairro: 'Centro', logradouro: 'Rua Prefeito Alberto Moura', uf: 'MG' },
            { cep: '37470-960', bairro: 'Centro', logradouro: 'Rua Prefeito Alberto Moura', uf: 'MG' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (u.includes('/37470959/')) {
        return new Response(
          JSON.stringify({
            cep: '37470-959',
            bairro: 'Centro',
            localidade: 'São Lourenço',
            uf: 'MG',
            logradouro: 'Rua Prefeito Alberto Moura',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (u.includes('/37470000/')) {
        return new Response(JSON.stringify({ erro: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected url ${u}`);
    };

    const cache: Record<string, unknown> = {};
    const refined = await refineCepViaLogradouro(
      {
        cep_rf: '37470-000',
        uf: 'MG',
        municipio: 'São Lourenço',
        logradouro: 'Prefeito Alberto Moura',
        tipo_logradouro: 'RUA',
      },
      { fetch: mockFetch, cache: cache as never },
    );
    assert.equal(refined.ok, true);
    if (!refined.ok) return;
    assert.equal(refined.cep, '37470959');
    assert.equal(refined.cep_rf, '37470000');

    const lookup = await lookupBairroFromCep(refined.cep, { fetch: mockFetch, cache: cache as never });
    assert.equal(lookup?.bairro, 'Centro');
  });

  it('refineCepViaLogradouro invalida cache ok com CEP genérico', async () => {
    const calls: string[] = [];
    const mockFetch: LookupFetch = async (url) => {
      calls.push(String(url));
      const u = String(url);
      if (u.includes('/RS/Marau/')) {
        return new Response(
          JSON.stringify([{ cep: '99150-123', bairro: 'Centro', uf: 'RS' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected ${u}`);
    };

    const cache: Record<string, { ok: true; cep: string; cep_rf: string }> = {
      'addr:rs:marau:rua gilda fialho': {
        ok: true,
        cep: '99150000',
        cep_rf: '99150000',
      },
    };

    const refined = await refineCepViaLogradouro(
      {
        cep_rf: '99150000',
        uf: 'RS',
        municipio: 'Marau',
        logradouro: 'GILDA FIALHO',
        tipo_logradouro: 'RUA',
      },
      { fetch: mockFetch, cache: cache as never },
    );

    assert.equal(refined.ok, true);
    if (refined.ok) assert.equal(refined.cep, '99150123');
    assert.equal(calls.length, 1);
  });
});
