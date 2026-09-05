# TP bairro — CEP como fonte da verdade

Date: 2026-09-02  
Status: **approved — Fase 1 CEP implementada (2026-09-02); F2.2 implementada (2026-09-02)**  
Scope: resolver `bairro` para academias TotalPass no `tp-bairro-index` e audit de cobertura.

## Princípio

**Bairro só existe no índice quando derivado de um CEP válido.**

- CEP → lookup Correios (ViaCEP / BrasilAPI) → campo `bairro` / `neighborhood`
- **Nunca** inferir bairro de texto de endereço (segmentos separados por vírgula, `road`, quadra/lote DF, `SN`, etc.)
- **Nunca** tratar resultado Nominatim (`suburb`, `neighbourhood`) como bairro canônico
- Sem CEP confiável → **`fail` honesto** (`sem_cep` / `cep_lookup_fail`), não preencher com palpite

O smoke `tpDetailEnderecoParser` (parse `detail.endereco`) é **exploratório apenas** — ~10% das falhas Nominatim, muitos falsos positivos DF. **Não entra no pipeline de produção.**

## Por quê

| Abordagem | Problema |
|-----------|----------|
| Parse `detail.endereco` | `"QD 5"`, `"CASA 1"`, `"Area Especial"` — fragmento, não bairro |
| Nominatim reverse | OSM inconsistente no BR; WARN ≠ bairro ausente na cidade |
| `road` / logradouro | Rua ≠ bairro (regra explícita do projeto) |
| Receita `bairro` direto | Campo RF útil para **match**, mas bairro canônico = **CEP lookup** (base Correios, alinhada catálogo) |
| Receita `bairro` direto | Campo RF útil para **match**, mas bairro canônico = **CEP lookup** (base Correios, alinhada catálogo) |
| ViaCEP busca reversa **livre** (50 CEPs, palpite) | Ilusão — proibido |
| CEP município `xxxxx-000` | RF comum; lookup direto **sem bairro** — não significa cidade sem bairros |

## F2.2 — Refinar CEP genérico via logradouro Receita

### Problema observado (batch 2026-09-02)

CEP `37470-000` (São Lourenço/MG) aparece **7×** nas 948 falhas. ViaCEP/BrasilAPI retornam `erro` — CEP é **faixa do município**, não de logradouro.

A cidade **tem** bairros com CEP fino (ex.: **Centro** → `37470-959` … `37471-959`). Receita registrou CEP genérico; bairro existe na base Correios.

**~400 falhas** seguem padrão `xxxxx-000` (`data/processed/tp-cep-failures-by-region.json`).

### Regra F2.2 (não contradiz CEP = verdade)

Quando lookup do CEP RF falha **e** CEP é genérico município:

```
isCepGenerico(cep) := últimos 3 dígitos === '000' (ex.: 37470-000, 48700-000)

Se isCepGenerico && cep_lookup_fail && receita match alta:
  1. Ler RF: uf, municipio, tipo_logradouro, logradouro, numero
  2. ViaCEP GET /ws/{UF}/{Cidade}/{Logradouro}/json/  (mín. 3 chars)
  3. Disambiguar — só aceitar CEP refinado se:
     a) exatamente 1 resultado → usar esse CEP → lookup → bairro
     b) N resultados + numero RF → filtrar por faixa par/ímpar do complemento se disponível;
        se restar exatamente 1 → OK
     c) ambíguo (0 ou >1 após filtros) → fail honesto (cep_logradouro_ambiguo)
  4. CEP refinado entra no lookup normal (passo 3 waterfall)
  5. Registro final ainda exige cep + bairro via lookup Correios
```

**Proibido em F2.2:** escolher CEP “mais próximo”, primeiro da lista, ou copiar `receita.bairro` sem lookup.

### Por que é honesto (vs ilusão)

| | F2.2 | Ilusão (proibida) |
|--|------|-------------------|
| Output | CEP específico → lookup → bairro Correios | Parse vírgula / Nominatim |
| Input | Logradouro + número **RF** (match `num+rua` alta) | Palpite de rua TP abreviada |
| Ambiguidade | fail | pick first of 50 |
| Bairro final | sempre ViaCEP/BrasilAPI | texto endereço |

Equivalente à [API Busca CEP Correios](https://www.correios.com.br/atendimento/developers/manuais/manual-api-busca-cep) `GET /cep/v2/enderecos?uf=&localidade=&logradouro=` — ViaCEP grátis, mesma lógica.

### Fixture canônica F2.2

| Campo | Valor |
|-------|-------|
| CEP RF | `37470000` (São Lourenço/MG — genérico) |
| Logradouro RF | *(do CNPJ match — validar no dump)* |
| CEP refinado esperado | faixa `37470959+` (Centro) |
| Bairro esperado pós-lookup | `Centro` |
| Falha se | >1 CEP após filtro por número |

### Dados Receita necessários

Estender `TpReceitaCepHit` / join RF:

```typescript
type TpReceitaAddressHit = TpReceitaCepHit & {
  uf: string;
  municipio: string;       // nome, não código IBGE
  tipo_logradouro?: string;
  logradouro: string;
  numero?: string;
  cep_rf: string;          // original (pode ser genérico)
  cep_refined?: string;    // pós F2.2
};
```

Fonte: `receita-cnae-wellness-principal-ativos.json` (campos já no filter DuckDB).

## Fluxo aprovado (waterfall)

```
Para cada gym TP (gym_id):

1. CEP conhecido?
   ├─ Receita match (tp_id → cnpj, tier=alta) → receita.cep
   ├─ Literal 8 dígitos em detail.endereco / full_address (regex \d{5}-?\d{3})
   └─ Cache tp-cep-cache.json (hit anterior)

2. CEP normalizado (somente dígitos, 8 chars, DV válido se checável)

3. Lookup CEP (cache → ViaCEP → fallback BrasilAPI)
   → bairro = response.bairro | response.neighborhood

3b. [F2.2] Se passo 3 fail && cep genérico (-000) && receita tem logradouro:
   → ViaCEP busca por endereço → CEP refinado (regras disambiguação)
   → volta ao passo 3 com cep_refined

4. bairro_slug = bairroSlug(bairro)
   source = 'receita_cep' | 'receita_logradouro_cep' | 'detail_cep' | ...
   registerAggregatorBairro + match_slugs (como hoje)

5. Sem CEP → failures[] `sem_cep`
6. **CEP genérico (-000) sem bairro fino** (lookup vazio + F2.2 falhou ou só devolveu -000):
   → `source=cep_municipio`, `bairro` = nome do **município**, `cep_geral=true`
   → `nota`: "CEP geral do município (X/UF) — Correios não distingue bairro neste CEP"
   → **não** inventa bairro de rua/parse/Nominatim
```

### Obter CEP via Receita (caminho principal)

1. Rebuild `receita-x-totalpass-match` com universo **wellness** (`receita-cnae-wellness-principal-ativos.json`)
2. Linhas `match=1` + `tier=alta` → mapa `tp_id → cnpj`
3. Join `cnpj → receita.cep` no dump RF (campo já presente no filter)
4. **Não** copiar `receita.bairro` direto — usar só o **CEP** como input do passo 3

Confiança do match endereço (`num+rua`, `addr_sim=100`) valida o CEP, não substitui lookup.

### Lookup CEP (implementação)

| Provider | URL | cache key |
|----------|-----|-----------|
| ViaCEP | `GET https://viacep.com.br/ws/{cep}/json/` | `cep:{8digits}` |
| BrasilAPI | `GET https://brasilapi.com.br/api/cep/v2/{cep}` | fallback |

- Rate: ~1 req/s, cache persistente `data/processed/tp-cep-cache.json`
- Resposta `erro: true` → fail, não retry infinito
- Idempotente: mesmo CEP → mesmo bairro

### O que fica fora (proibido em produção)

- `parseBairroFromDetailEndereco` como resolvedor
- `pickBairroFromNominatimAddress` como resolvedor
- ViaCEP `/{UF}/{Cidade}/{Logradouro}/` **sem** gate `isCepGenerico` + **sem** disambiguação estrita
- Escolher 1º CEP de lista quando N>1
- Qualquer fallback que escreva `bairro` sem `cep` no registro do índice
- Copiar `receita.bairro` direto no index

## Schema `TpBairroResolved` (evolução)

```typescript
type TpBairroSource =
  | 'receita_cep'              // CEP RF específico
  | 'receita_logradouro_cep'   // CEP refinado F2.2 a partir de -000
  | 'cep_municipio'            // CEP -000: unidade = município (cep_geral)
  | 'detail_cep'
  | 'viacep'
  | 'brasilapi'
  | 'cache';

type TpBairroResolved = {
  bairro: string;        // bairro Correios; se cep_geral → nome do município
  bairro_slug: string;
  cep: string;           // 8 dígitos — CEP usado no lookup final (pode ≠ cep_rf)
  cep_rf?: string;       // CEP original Receita quando refinado
  source: TpBairroSource;
  cnpj?: string;
  lat: number;
  lng: number;
  resolved_at: string;
  cep_geral?: boolean;
  municipio?: string;
  uf?: string;
  nota?: string;
};
```

Registro sem `cep` → inválido para audit TP coverage.

## Migração do index atual

- Entradas Nominatim existentes: marcar `legacy_nominatim` ou re-resolver via CEP quando possível
- `resolve-tp-bairros.ts`: substituir Nominatim por waterfall CEP
- Manter `smoke:tp-detail-bairro-failures` só como benchmark de “quanto texto engana”

## Métricas de sucesso

| Métrica | Alvo |
|---------|------|
| % gyms com `cep` no index | subir vs baseline |
| % failures `sem_cep` | honesto, não mascarado |
| TP coverage audit (T4) | sobe após re-run audit |
| Falsos bairro (DF quadra) | **0** em produção |

## Artefatos

| Path | Papel |
|------|-------|
| `data/processed/receita-x-totalpass-match.csv` | tp_id ↔ cnpj (rebuild wellness) |
| `data/processed/receita-cnae-wellness-principal-ativos.json` | cep por cnpj |
| `data/processed/tp-cep-cache.json` | cache lookup (novo) |
| `data/processed/tp-bairro-index.json` | saída canônica |
| `scripts/lib/tpCepResolver.ts` | lookup + normalização + **F2.2 refine** |
| `scripts/lib/tpReceitaCepMatch.ts` | tp_id ↔ endereço RF completo |
| `data/processed/tp-cep-failures-by-region.json` | baseline 948 falhas pós-batch |

## Ordem de implementação

1. ~~`tpCepResolver.ts` + cache + testes~~ ✅ (2026-09-02)
2. ~~`build-tp-bairro-from-receita-cep.ts` + batch 6611~~ ✅ (5970 OK, 641 fail batch)
3. ~~`resolve-tp-bairros.ts` CEP-only~~ ✅
4. ~~`retry-tp-cep-failures.ts`~~ ✅ (948 failures documentadas)
5. **F2.2** — `isCepGenerico`, `refineCepViaLogradouro`, estender `TpReceitaCepHit` com logradouro/numero/uf/municipio
6. Testes: fixture `37470-000` São Lourenço → Centro; caso ambíguo → fail
7. Re-run `retry:tp-cep-failures` + `audit:bairro-coverage` — meta: reduzir ~400 `xxxxx-000`

## Referências

- Falhas pós-batch: `data/processed/tp-cep-failures-by-region.json` — 948 total, ~400 padrão `xxxxx-000`
- Exemplo `37470-000` São Lourenço → bairro Centro com CEP fino `37470-959+`
- Smoke parse detail (não produção): `data/processed/tp-detail-bairro-failures-smoke.json`
- Wellness spec: `Docs/superpowers/specs/2026-09-02-receita-cnae-wellness-design.md`
- Fixture Vivedouro: CNPJ `29460053000177`, CEP RF → lookup → Santana
- Correios Dados Abertos: sem API pública — [link](https://www.correios.com.br/acesso-a-informacao/dados-abertos)
- API Busca CEP (contrato): [manual](https://www.correios.com.br/atendimento/developers/manuais/manual-api-busca-cep)
