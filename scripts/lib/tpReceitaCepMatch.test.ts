import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadTpReceitaCepMap } from './tpReceitaCepMatch.ts';

describe('tpReceitaCepMatch', () => {
  it('loadTpReceitaCepMap join match alta + receita cep', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-receita-cep-'));
    const receitaPath = path.join(dir, 'receita.json');
    const matchPath = path.join(dir, 'match.csv');

    await fs.writeFile(
      receitaPath,
      JSON.stringify([
        {
          cnpj: '51835317000421',
          cep: '08568120',
          logradouro: 'Rua Teste',
          uf: 'SP',
          tipo_logradouro: 'RUA',
          numero: '100',
        },
        { cnpj: '99999999000199', cep: '01001000', logradouro: 'Rua X', uf: 'SP' },
      ]),
    );

    await fs.writeFile(
      matchPath,
      [
        'cnpj,nome,uf,city,ibge,bairro,cnae_match,match,tier,method,addr_sim,name_sim,tp_id,tp_name',
        '51835317000421,,SP,Poá,3539806,JARDIM ESTELA,principal,1,alta,num+rua,100,0,tp-abc,Mansão Maromba',
        '99999999000199,,SP,SP,3550308,CENTRO,principal,1,media,num+rua,80,0,tp-low,Low conf',
        '11111111000111,,SP,SP,3550308,CENTRO,principal,0,,,,,,',
      ].join('\n'),
    );

    const map = await loadTpReceitaCepMap({ matchCsvPath: matchPath, receitaPath });
    assert.equal(map.size, 1);
    assert.equal(map.get('tp-abc')?.cep, '08568120');
    assert.equal(map.get('tp-abc')?.cnpj, '51835317000421');
    assert.equal(map.get('tp-abc')?.logradouro, 'Rua Teste');
    assert.equal(map.get('tp-abc')?.uf, 'SP');
    assert.equal(map.get('tp-abc')?.municipio, 'Poá');
    assert.equal(map.has('tp-low'), false);
  });
});
