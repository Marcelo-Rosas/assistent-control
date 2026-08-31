---
name: gymsite-blog-receita
description: >-
  Gera post Markdown Blog GymSite a partir de ficha JSON receita-blog
  (trimestre Top N). Use após npm run report:receita-blog. Números só da ficha.
---

# GymSite Blog — Receita CNAE

## Quando usar

- Após `npm run report:receita-blog -- --quarter YYYY-QN --n N`
- Humano pede posts do trimestre / primeiro material Blog GymSite

## Quando NÃO usar

- Inventar PIB, renda, bairro ou contagem fora da ficha
- Publicar CMS (fase 2)
- Substituir Scout mensal `/receita`

## Input

Um ou mais paths:

`data/processed/receita-blog/{quarter}/{slug}.json`

## Output

`Docs/blog/gymsite/{quarter}-{slug}-{mortalidade|crescimento|ambos}.md`

Angle no filename:
- `ambos` se `rankings.mortalidade` **e** `rankings.crescimento`
- senão o ranking presente

## Regras

1. Todo número do texto deve existir na ficha.
2. Se `gymsite.status=indisponivel`, dizer indisponível — não inventar PIB/renda.
3. Causa/efeito = associação / hipótese rotulada; não acusar sem dado na ficha.
4. Estrutura: gancho → movimento trimestre → vida/faixas → bairros/onda → PIB/renda → fechamento GymSite Intelligence (sem métrica falsa).
5. Tom: gerencial mercado fitness.

## Checklist antes de salvar

- [ ] Contagens = `ficha.movimento`
- [ ] Mediana/faixas = `ficha.vida_baixados`
- [ ] Bairros citados ⊆ `ficha.bairros_fechamento`
- [ ] PIB/renda só se `gymsite.status=ok`
- [ ] Onda meses = `ficha.onda.baixados_por_mes`

## Spec

`Docs/superpowers/specs/2026-08-04-receita-blog-gymsite-design.md`
