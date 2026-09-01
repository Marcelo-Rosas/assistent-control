# GuruPass Enrich — schema JSON (Pass 2)

Documentação dos campos gerados pelo enrich GuruPass (`gurupassDetailSchema.ts`, futuro `enrich-gurupass-details.ts`).

**Epic Linear:** [CLA-13](https://linear.app/gymsite/issue/CLA-13) · **F0:** [CLA-14](https://linear.app/gymsite/issue/CLA-14)

---

## Arquitetura (vs WH/TP)

| Camada | GuruPass |
|--------|----------|
| **Lista** | `GET /user/establishments/search?citySlug={slug}&page=N&limit=200` — paginação real |
| **Detalhe API** | `/user/establishments/{slug}` → **401** anônimo |
| **Detalhe público** | `/detalhes-da-academia/{slug}/` → objeto `establishment` no Next.js |
| **Geocode** | **Não necessário** — `citySlug` sozinho filtra |

---

## Campos disponíveis

### Lista (API search)

- `gurupass_id`, `slug`, `name`, `fullAddres` (typo da API)
- `city`, `neighborhood`, `state` (strings flat)
- `latitude`, `longitude`, `distance`
- `modalities[]`, `tags[]`, `description`
- `products[]` → `{ name, description, cost_credits, cost_cents }`
- `photos[]`, `lowestPrice`, `openingStatus`
- `isPartner`, `isNew`

### Enrich (página detalhe → `establishment`)

- `fullAddress`, `description`, `phone`, `website`
- `working_hours_text` (quando preenchido — muitas academias deixam `null`)
- `googlePlaceId`
- `neighborhood`, `city`, `state` (objetos `{ name, code? }`)
- `openingStatus` (aberto/fechado + próximo horário)
- `modalities[]`, `products[]`, `photos[]`, `lowestPrice`

### **Não existe no GuruPass**

- **Comodidades** (armário, estacionamento, vestiário etc.) — diferente da Wellhub
- Horário estruturado por dia da semana — horário costuma vir em `products[].description` (texto livre)

O schema TS expõe `comodidades: null` explicitamente para não confundir com WH.

---

## Tipos normalizados (`GuruPassGymNormalized`)

```json
{
  "id": "uuid",
  "slug": "team-souza-fight",
  "nome": "Team Souza Fight",
  "endereco": "Avenida Ecoville, 296 ...",
  "bairro": "Sarandi",
  "cidade": "Porto Alegre",
  "uf": "Rio Grande do Sul",
  "localizacao": { "lat": "-29.99", "lng": "-51.12" },
  "produtos_planos": [
    { "nome": "Aula de Muay Thai", "horario": "2ª, 4ª e 6ª: 7h", "creditos": 70, "preco_centavos": 3500 }
  ],
  "menor_preco": { "hasProduct": true, "name": "Aula de Muay Thai", "lowerPrice": 70 },
  "fotos": ["https://..."],
  "status_funcionamento": { "open": true, "nextClosing": { "time": "21:00" } },
  "url_detalhe": "https://www.gurupass.com.br/detalhes-da-academia/team-souza-fight/"
}
```

---

## Scrape nacional (F1)

```bash
npm run fetch:gurupass-br              # 5.571 municípios · citySlug · limit=200
LIMIT=5 npm run fetch:gurupass-br      # piloto
FORCE_RESCrape=1 npm run fetch:gurupass-br   # ignora completed antigo (lat/lng)
```

Env: `DELAY_MS`, `PAGE_LIMIT` (default 200), `MAX_PAGES` (0=all), `CHECKPOINT_EVERY`.

Progress migra automaticamente de Pass 1 (lat/lng) → v2 (citySlug): limpa `completed`, mantém `gymById` para merge.

---

## Comandos (F0)

```bash
npm run test:gurupass-schema     # testes offline vs fixtures POA
npm run smoke:gurupass-poa       # smoke consolidado
npm run schema:gp -- team-souza-fight   # CLI detail ao vivo

# Smoke com API live:
LIVE=1 npm run smoke:gurupass-poa
```

---

## Fixtures

| Arquivo | Conteúdo |
|---------|----------|
| `data/fixtures/gurupass/porto-alegre-consolidated.json` | 13 academias POA (Python scraper) |
| `data/fixtures/gurupass/search-porto-alegre-p1.json` | API search page 1 |
| `data/fixtures/gurupass/team-souza-fight.html` | Página detalhe real |

---

## Próximas fases (CLA-15+)

| Fase | Script |
|------|--------|
| F1 | Refatorar `scrape-gurupass-brasil.ts` → `citySlug` ✅ |
| F2 | `enrich-gurupass-details.ts` |
| F3 | Ingest + re-embed |
