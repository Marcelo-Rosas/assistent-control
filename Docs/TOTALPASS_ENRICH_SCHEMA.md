# TotalPass Enrich — schema JSON (Pass 2)

Documentação dos campos gerados pelo `enrich-totalpass-details.ts` (páginas de detalhe `/br/academias/<slug>/`).

## Arquivos no disco

| Artefato | Caminho |
|----------|---------|
| Entrada (lista) | `data/raw/totalpass-brasil-all.json` |
| Saída por academia | `data/processed/totalpass-enriched/by-id/<gym_id>.json` |
| Checkpoint | `data/processed/totalpass-enrich-progress.json` |
| **Monitor de falhas** | `data/processed/totalpass-enrich-failures.json` |
| Log stdout | `data/raw/totalpass-enrich.out.log` |
| Log stderr | `data/raw/totalpass-enrich.err.log` |

## Comandos

```bash
npm run enrich:tp-details      # batch (retomável)
npm run monitor:tp-enrich      # status + sync falhas
npm run monitor:tp-enrich -- --json
```

---

## 1. Registro enriquecido (`by-id/<gym_id>.json`)

Um arquivo por academia. Estrutura completa:

```json
{
  "gym_id": "uuid-da-academia",
  "slug": "central-fitness-72f760e3-3d0c-412d-b1de-4f6fefceb0bf",
  "enriched_at": "2026-08-28T12:00:00.000Z",
  "list": {
    "name": "Central fitness",
    "full_address": "Rua Pedro Angelli, 155",
    "location": { "lat": -23.523, "lng": -46.342 },
    "municipios_relacionados": ["Poá"],
    "municipios_busca": ["Poá"],
    "accessible_on_plans": [],
    "accessible_from_company_plan": {},
    "warning_message": null,
    "featured_modality_id": "106"
  },
  "detail": {
    "academia": "Central fitness",
    "url": "https://totalpass.com/br/academias/central-fitness-.../",
    "endereco": "rua pedro angelli, 155",
    "contato": {
      "telefone": "11993502478",
      "instagram": "https://www.instagram.com/centralfitnes.s/",
      "email": "centralfitnessacademia@outlook.com"
    },
    "modalidades": ["Musculação", "Muay Thai", "Boxe"],
    "modalidades_e_planos": [
      {
        "modalidade": "Musculação",
        "categoria": "Musculação + Aulas",
        "plano_minimo": "TP 1+"
      }
    ],
    "horarios_academia": {
      "segunda-feira": "06:00 às 22:00",
      "sabado": "06:00 às 22:00 / 09:00 às 14:00"
    },
    "comodidades": ["Armários", "Bebedouro", "Wi-fi"]
  }
}
```

### Tabela de campos — raiz

| Campo | Tipo | Origem | Descrição |
|-------|------|--------|-----------|
| `gym_id` | `string` | list API | UUID estável da academia |
| `slug` | `string` | list API | Slug da URL TotalPass |
| `enriched_at` | `string` (ISO) | pipeline | Timestamp do enrich |
| `list` | `object` | list API | Snapshot da busca geográfica |
| `detail` | `object` | detail page | Schema de qualidade (abaixo) |

### Tabela de campos — `list`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | `string \| null` | Nome na API de busca |
| `full_address` | `string \| null` | Endereço resumido (sem cidade/CEP) |
| `location` | `{ lat, lng } \| null` | Coordenadas |
| `municipios_relacionados` | `string[]` | Municípios atribuídos no scrape |
| `municipios_busca` | `string[]` | Municípios da busca |
| `accessible_on_plans` | `object[]` | Planos TP com preço (list API) |
| `accessible_from_company_plan` | `object \| null` | Plano mínimo corporativo |
| `warning_message` | `string \| null` | Aviso da academia |
| `featured_modality_id` | `string \| null` | ID modalidade destaque |

### Tabela de campos — `detail`

| Campo | Tipo | Origem página | Descrição |
|-------|------|---------------|-----------|
| `academia` | `string` | JSON-LD `name` | Nome oficial |
| `url` | `string` | construído | URL canônica |
| `endereco` | `string` | JSON-LD `address.streetAddress` | Logradouro |
| `contato.telefone` | `string \| null` | JSON-LD `telephone` | Telefone |
| `contato.instagram` | `string \| null` | payload `website` | Instagram ou site |
| `contato.email` | `string \| null` | payload `email` | E-mail |
| `modalidades` | `string[]` | payload `modalities` | Lista de modalidades |
| `modalidades_e_planos` | `object[]` | `gym_plan` + join | Modalidade × categoria × plano |
| `modalidades_e_planos[].modalidade` | `string` | modalities | Nome traduzido |
| `modalidades_e_planos[].categoria` | `string` | gym_plan `name` | Ex.: "Musculação + Aulas" |
| `modalidades_e_planos[].plano_minimo` | `string` | gym_plan plan | Ex.: "TP 1+" |
| `horarios_academia` | `Record<string,string>` | payload `gymHours` | Chave = dia (sem acento), valor = horário |
| `comodidades` | `string[]` | payload `structures` | Armários, Wi-fi, etc. |

### Campos **não** incluídos (deprecados)

| Campo | Motivo |
|-------|--------|
| `status_atual` | Volátil ("Aberta agora") — inútil para RAG/ingest |
| `horario_hoje` | Volátil — idem |

---

## 2. Checkpoint (`totalpass-enrich-progress.json`)

```json
{
  "completed": ["uuid-1", "uuid-2"],
  "failed": [
    {
      "gym_id": "uuid-x",
      "slug": "buddha-spa-college-ltda",
      "error": "HTTP 502 em https://totalpass.com/..."
    }
  ],
  "lastUpdate": "2026-08-28T12:44:08.114Z"
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `completed` | `string[]` | IDs já enriquecidos com sucesso |
| `failed` | `object[]` | Falhas definitivas nesta rodada |
| `failed[].gym_id` | `string` | UUID |
| `failed[].slug` | `string` | Slug para retry manual |
| `failed[].error` | `string` | Mensagem de erro |
| `lastUpdate` | `string` | ISO timestamp |

---

## 3. Monitor de falhas (`totalpass-enrich-failures.json`)

Atualizado a cada checkpoint (25 gyms) e via `npm run monitor:tp-enrich`.

```json
{
  "updated_at": "2026-08-28T12:44:08.114Z",
  "summary": {
    "total_gyms": 30706,
    "completed": 2702,
    "failed": 1,
    "pending": 28003,
    "pct_complete": "8.8%"
  },
  "failures": [
    {
      "gym_id": "16bc5e3f-3055-4e87-ad7d-08e17f82b342",
      "slug": "buddha-spa-college-ltda",
      "url": "https://totalpass.com/br/academias/buddha-spa-college-ltda/",
      "error": "HTTP 502 em https://totalpass.com/br/academias/buddha-spa-college-ltda/"
    }
  ]
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `updated_at` | `string` | Última sincronização |
| `summary.total_gyms` | `number` | Total no `all.json` |
| `summary.completed` | `number` | OK |
| `summary.failed` | `number` | Falhas |
| `summary.pending` | `number` | Restante |
| `summary.pct_complete` | `string` | Percentual |
| `failures` | `array` | Lista detalhada para retry |

### Retry de falhas

1. Aguardar fim do batch ou pausar processo
2. Remover entrada de `failed` no progress (ou gym_id de `completed` se já estiver)
3. Relançar `npm run enrich:tp-details` — só reprocessa pendentes/falhas não em `completed`

Erros **502/429** são transitórios; **404** pode indicar slug inválido.

---

## 4. Próximo passo (ingest)

O ingest ainda usa `totalpass-brasil-all.json` (Pass 1). Quando adaptado, o chunk em `eros_knowledge_chunks` deverá montar `text` a partir de `detail` + fallback `list`.

Campos candidatos para `meta` no Supabase:

```json
{
  "gym_id": "uuid",
  "source_kind": "totalpass_detail",
  "source_ref": "slug",
  "nome_academia": "string",
  "cidade": "string",
  "modalidades": ["string"],
  "planos_aceitos": ["string"],
  "plano_minimo": "string",
  "comodidades": ["string"],
  "telefone": "string",
  "email": "string",
  "instagram": "string"
}
```
