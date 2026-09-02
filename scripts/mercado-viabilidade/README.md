# Mercado & Viabilidade — Receita × TotalPass × Renda × Aluguel (MRLR)

Análise standalone de **mercado de academias** para consultoria comercial. Cruza a base
**Receita Federal** (CNAE 9313100 — condicionamento físico) com o agregador **TotalPass**,
enriquece com **renda por bairro** (IBGE, espelho Supabase `renda_bairro`) e uma camada de
**aluguel comercial (modelo MRLR)** adaptada do pipeline GymSite. Alimenta um dashboard
TensorBoard (Projector nacional + Projector de viabilidade por bairro).

> **Proveniência:** scripts gerados em sessão de análise; caminhos absolutos apontam para o
> scratchpad da sessão e para um venv Python isolado (com pandas/sklearn/rapidfuzz/tensorflow).
> São o **registro do método** — para re-executar, ajuste `ROOT`/`PROC`/`LOG` e o interpretador.
> Os **dados de saída** vivem versionados em `data/processed/` (ver abaixo).

## Pipeline

1. **`match_receita_tp.py`** — cruzamento Receita × TotalPass (TP não tem CNPJ). Bloco por
   UF+número → âncora logradouro (fuzzy, rapidfuzz) **E** nome_fantasia. Precision-first.
   Saída: `receita-x-totalpass-match.csv/.json`, `receita-x-totalpass-penetracao.json`.
   → consumido pelo lib canônico `scripts/lib/tpReceitaCepMatch.ts` (tier alta → tp_id→CEP).
2. **`parse_mrlr_inputs.py` / `parse_renda.py`** — parseiam exports do Supabase (`renda_bairro`,
   `municipio_pib`) salvos como blobs → `renda-bairro-*.json`, `municipio-pib.json`.
3. **`mrlr_aluguel.py`** — porta fiel do modelo **MRLR IBAPE-GO** (R²=0,8633), coef. fixos:
   `VU = [b0 + b1·ln(área) + b2·ln(padrão) + b3·local + b4·ln(porte) + b5/PIB + b6·fator]²`.
   Sanity Cocó/Fortaleza (900 m², padrão 3, porte 4) → **VU = 26,37/m²** (bate com o GymSite).
   Saída: `aluguel-mrlr-nacional.json` (VU R$/m² por bairro, área ref 500 m²).
   **Honestidade:** calibração em Goiás → aplicação nacional é **extrapolação geográfica**;
   `local=2` default (sem zoneamento nacional); aluguel é **estimativa**, não medido.
4. **`bairro_resolver.py`** — resolver de cobertura **~99%** (meta atingida, zero "sem dado"):
   cascata **bairro exato → fuzzy (dentro do município) → mediana do município**. Expande
   abreviações (jd/vl/pq/st…). Cada valor carrega `match_level` (transparência de granularidade —
   ~50% dos bairros usam renda a nível de município por esparsidade do catálogo IBGE).
5. **`enrich_whitespace.py`** — filtro clínica (config canônica `data/config/receita-cnae-segments.json`)
   + resolver → lista de prospecção limpa `receita-whitespace-academias.csv` (academia-alvo fora
   do TP, com renda + aluguel + margem + contato). Base enriquecida: `receita-enriched-totalpass.csv`.
6. **TensorBoard** — `tb_projector_nacional.py` (30.701 academias, +`faixa_aluguel`/`match_renda`),
   `tb_viabilidade.py` (16.777 bairros: renda×aluguel×oferta×margem), `tb_mrlr_surface.py`
   (VU vs área, auditoria da extrapolação), `tb_viab_static.py` (render 2D fallback).

## Saídas em `data/processed/`
`receita-x-totalpass-match.csv`, `receita-x-totalpass-penetracao.json`,
`receita-whitespace-academias.csv`, `receita-enriched-totalpass.csv`,
`aluguel-mrlr-nacional.json`, `renda-bairro-by-ibge-nacional.json`,
`renda-bairro-percentil.json`, `municipio-pib.json`.
