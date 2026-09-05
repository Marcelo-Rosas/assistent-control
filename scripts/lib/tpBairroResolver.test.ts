import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickBairroFromNominatimAddress, resolveTpBairroViaCep } from './tpBairroResolver.ts';
import type { LookupFetch } from './tpCepResolver.ts';

describe('tpBairroResolver', () => {
  it('pickBairroFromNominatimAddress prioriza suburb', () => {
    assert.equal(
      pickBairroFromNominatimAddress({
        quarter: 'Vila Alto da Boa Esperança',
        suburb: 'IAPI',
        city: 'Salvador',
      }),
      'IAPI',
    );
  });

  it('pickBairroFromNominatimAddress fallback quarter', () => {
    assert.equal(
      pickBairroFromNominatimAddress({ quarter: 'Farroupilha', city: 'Porto Alegre' }),
      'Farroupilha',
    );
  });

  it('resolveTpBairroViaCep F2.2 generic -000 + logradouro RF', async () => {
    const mockFetch: LookupFetch = async (url) => {
      const u = String(url);
      if (u.includes('/37470000/')) {
        return new Response(JSON.stringify({ erro: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('brasilapi') && u.includes('37470000')) {
        return new Response('{}', { status: 404 });
      }
      if (u.includes('/MG/S%C3%A3o%20Louren%C3%A7o/')) {
        return new Response(
          JSON.stringify([{ cep: '37470-959', bairro: 'Centro', uf: 'MG' }]),
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
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected ${u}`);
    };

    const r = await resolveTpBairroViaCep({
      gymId: 'gym-1',
      lat: -22.1,
      lng: -45.05,
      receitaHit: {
        tp_id: 'gym-1',
        cnpj: '12345678000199',
        cep: '37470000',
        uf: 'MG',
        municipio: 'São Lourenço',
        logradouro: 'Prefeito Alberto Moura',
        tipo_logradouro: 'RUA',
        tp_name: 'Test',
        method: 'num+rua',
      },
      fetch: mockFetch,
    });

    assert.equal(r?.bairro, 'Centro');
    assert.equal(r?.cep, '37470959');
    assert.equal(r?.cep_rf, '37470000');
    assert.equal(r?.source, 'receita_logradouro_cep');
  });

  it('resolveTpBairroViaCep CEP -000 sem refine → município + cep_geral', async () => {
    const mockFetch: LookupFetch = async (url) => {
      const u = String(url);
      if (u.includes('/99150000/')) {
        return new Response(
          JSON.stringify({
            cep: '99150-000',
            bairro: '',
            localidade: 'Marau',
            uf: 'RS',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (u.includes('/RS/Marau/')) {
        return new Response(
          JSON.stringify([{ cep: '99150-000', bairro: '', uf: 'RS' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (u.includes('brasilapi')) {
        return new Response('{}', { status: 404 });
      }
      throw new Error(`unexpected ${u}`);
    };

    const r = await resolveTpBairroViaCep({
      gymId: 'gym-marau',
      lat: -28.44,
      lng: -52.2,
      receitaHit: {
        tp_id: 'gym-marau',
        cnpj: '12345678000199',
        cep: '99150000',
        uf: 'RS',
        municipio: 'Marau',
        logradouro: 'GILDA FIALHO',
        tipo_logradouro: 'RUA',
        tp_name: 'Protein Box',
        method: 'num+rua',
      },
      fetch: mockFetch,
    });

    assert.equal(r?.bairro, 'Marau');
    assert.equal(r?.cep, '99150000');
    assert.equal(r?.source, 'cep_municipio');
    assert.equal(r?.cep_geral, true);
    assert.equal(r?.municipio, 'Marau');
    assert.ok(r?.nota?.includes('CEP geral do município'));
  });
});
