# Belo Horizonte: crescimento líquido no 1º trimestre de 2026

**Fonte dos números:** ficha `data/processed/receita-blog/2026-Q1/belo-horizonte-mg.json`  
**Ângulo:** crescimento (rank 2 no Top 3 absoluto do trimestre)  
**CNAE:** 9313100 (academia / atividade física)

## Movimento no trimestre

Em Belo Horizonte/MG, o parque ativo observado no dump era de **596** estabelecimentos com CNAE principal 9313100.

No 1º trimestre de 2026 (`2026-01` a `2026-03`):

- **Abriram:** 61
- **Fecharam:** 10
- **Saldo:** +51

Isso colocou a cidade na **2ª posição** do ranking de crescimento líquido (absoluto) do trimestre entre as Top 3.

## Tempo de vida dos que fecharam

Entre os **10** CNPJs baixados no trimestre com datas válidas:

| Faixa | Quantidade | % |
|-------|------------|---|
| &lt; 1 ano | 4 | 40% |
| 1–3 anos | 2 | 20% |
| 3–5 anos | 1 | 10% |
| 5 anos ou mais | 3 | 30% |

**Mediana de vida:** ~**2,27 anos**.

Leitura cautelosa: o crescimento líquido forte coexiste com uma fatia relevante de fechamentos jovens (40% com menos de 1 ano). Associação observável nos dados Receita — não prova causa única (custo, ponto, gestão etc. ficam fora desta ficha).

## Bairros e onda

- **Bairros com ≥2 fechamentos no trimestre:** nenhum na ficha (lista vazia). Sem drill de bairro estável neste recorte.
- **Onda (últimos 3 meses até fim do trimestre):** jan/2026 = 2 · fev = 4 · mar = 4 baixados.

A onda mostra aceleração de fechamentos de janeiro para fevereiro/março, ainda em volume baixo frente às 61 aberturas.

## Demografia econômica (GymSite / IBGE)

Status GymSite: **ok**.

- **População (espelho PIB):** 2.415.872  
- **PIB município (2023):** R$ 130.197.671.000  
- **PIB per capita:** ~R$ 53.893  
- **Renda per capita mediana entre 471 bairros** (Censo 2022 via GymSite): ~R$ 834  
- **Topo renda_pc bairros:** Senhor dos Passos (~R$ 13.736), Belvedere (~R$ 8.302), Savassi (~R$ 6.914)

Fonte PIB: BigQuery basedosdados (br_ibge_pib + br_ibge_populacao). Fonte renda: `renda_bairro` GymSite / IBGE Censo 2022.

## Fechamento

BH entra no 1º material da série Blog GymSite como case de **crescimento absoluto** com vida mediana curta nos baixados. Próximo passo operacional: comparar com um case de mortalidade do mesmo trimestre (ex. Fortaleza/Brasília nas fichas irmãs) e, no GymSite Intelligence, cruzar ponto a ponto com demografia de bairro quando o drill de fechamentos permitir n≥2.

---

*Gerado a partir da ficha determinística. Skill: `gymsite-blog-receita`.*
