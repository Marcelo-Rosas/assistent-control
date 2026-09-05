"""
Recomendador de planos — runner por CIDADE (fase 2: SP / RJ).
Renda por bairro vem de renda_bairro_sp_rj.json (fonte: Supabase cargo-flow-navigator,
tabela public.renda_bairro, IBGE Censo 2022, renda_pc em R$). Mesma logica do piloto POA:
peer-benchmark macro×renda_band + modelo de exclusividade nacional + gap por academia.

Uso: python recomendador_planos_cidade.py <sp|rj>
"""
import json, os, sys, re, unicodedata
import numpy as np, pandas as pd
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

R = r"C:\Users\marce\assistent-control"
OUT = os.path.join(R, "data", "processed", "recomendador-poa")
CIDADES = {
    'sp': {'cod': '3550308', 'municipio': 'São Paulo', 'catalogo': 'sao-paulo-sp.json', 'nome': 'Sao Paulo'},
    'rj': {'cod': '3304557', 'municipio': 'Rio de Janeiro', 'catalogo': 'rio-de-janeiro-rj.json', 'nome': 'Rio de Janeiro'},
}
TIER_ORDER = ['plan_tp_free','plan_tp_free_indirects','plan_tp0','plan_tp1','plan_tp1_plus','plan_tp2',
              'plan_tp2_plus','plan_tp3','plan_tp4','plan_tp5','plan_tp5_plus','plan_tp6','plan_tp7']
SH = {c: c.replace('plan_tp','TP').replace('_plus','+').replace('_free_indirects','Fi').replace('_free','F').upper() for c in TIER_ORDER}
TIER_WEIGHT = {c: 1.0 + max(0, (8 - i)) * 0.1 for i, c in enumerate(TIER_ORDER)}
MIN_PEERS, OFFER_HIGH = 15, 0.60
PREMIUM_ENTRY = {'plan_tp6', 'plan_tp7'}
EXCLUSIVITY_TIERS = {'nativa', 'propensa'}
BOOKING = re.compile(r'agendament|agendar|hora marcada|marcar hor[ao]rio|reserv[ae]r? (o )?hor[ao]rio')
# Filtro nº 4 — estabelecimento de SAUDE/CLINICA: o gym e' acessorio de um negocio de
# saude (consultas, exames, reabilitacao), TP7 e' coerente, nao gap. Sinal FORTE (nao
# pega "pilates e fisioterapia" comum) + entrada so' no topo. Ex.: Vivedouro Saude
# Integrada (confirmado por visita ao site: clinica multidisciplinar 10+ especialidades).
CLINIC_STRONG = re.compile(r'clinic|integrad|instituto|multidisciplin|reabilita|policlinic|hospital|\bmedic|odonto|ortoped|oncolog|oncomover|centro medic|saude integrad')

def slugify(t):
    t = unicodedata.normalize('NFD', str(t).lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')

def load_common():
    tp = json.load(open(os.path.join(R,"data","raw","totalpass-brasil-all.json"), encoding='utf-8'))['data']
    idx = json.load(open(os.path.join(R,"data","processed","tp-bairro-index.json"), encoding='utf-8'))['by_gym_id']
    macro = {}
    import csv
    for row in csv.DictReader(open(os.path.join(OUT,"modality_id_macro.csv"), encoding='utf-8')):
        macro[str(row['id'])] = row['macro_grupo']
    excl = json.load(open(os.path.join(OUT,'modality_exclusivity_model.json'), encoding='utf-8'))
    excl_tier = {m: v['tier'] for m, v in excl['modalidades'].items()}
    renda_all = json.load(open(os.path.join(OUT,'renda_bairro_sp_rj.json'), encoding='utf-8'))
    return tp, idx, macro, excl_tier, renda_all

def norm(t):
    t = unicodedata.normalize('NFD', str(t).lower()); return ''.join(c for c in t if unicodedata.category(c) != 'Mn')

# --- camada de MARCA/REDE (motivada pelo caso Bio Ritmo, confirmado no release CVM 3T25) ---
# Rede que modula tier de entrada pela renda do bairro (ex.: Smart Fit em TP2 popular,
# Bio Ritmo em TP5+ nobre) executa estrategia multi-marca — nao e' gap individual.
CHAIN_MIN_UNITS = 3          # min de unidades (com renda) p/ tratar como rede
CHAIN_RHO = 0.30            # Spearman tier×renda dentro da rede (positivo moderado) p/ "modula por renda";
                            # o filtro fino e' a condicao unidade-no-topo-de-tier-E-renda da propria rede
_STOP = {'academia','fitness','gym','studio','unidade','centro','club','clube','de','da','do','e'}

def chain_key(nome):
    toks = [w for w in re.sub(r'[^a-z0-9 ]',' ',norm(nome)).split() if w and w not in _STOP]
    return ' '.join(toks[:2]) if toks else ''

def _spearman(xs, ys):
    n = len(xs)
    if n < CHAIN_MIN_UNITS: return 0.0
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0]*len(v)
        i = 0
        while i < len(v):
            j = i
            while j+1 < len(v) and v[order[j+1]] == v[order[i]]: j += 1
            avg = (i+j)/2.0 + 1
            for k in range(i, j+1): r[order[k]] = avg
            i = j+1
        return r
    rx, ry = rank(xs), rank(ys)
    mx, my = sum(rx)/n, sum(ry)/n
    num = sum((a-mx)*(b-my) for a,b in zip(rx,ry))
    den = (sum((a-mx)**2 for a in rx)*sum((b-my)**2 for b in ry))**0.5
    return num/den if den else 0.0

def build_chain_model(tp, idx, macro, renda_all_slugs):
    """Pool SP+RJ+POA (cidades com renda). Por rede: rho(tier×renda), medianas."""
    import statistics as st
    from collections import defaultdict
    units = defaultdict(list)
    for g in tp:
        a = g['attributes']
        r = idx.get(g['id'])
        if not r or not r.get('bairro_slug'): continue
        rp = renda_all_slugs.get(r['bairro_slug'])
        if rp is None: continue
        pl = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
        ti = sorted({p['code'] for p in pl if p['code'] in TIER_ORDER}, key=TIER_ORDER.index)
        if not ti: continue
        ck = chain_key(a.get('name') or '')
        if ck: units[ck].append((TIER_ORDER.index(ti[0]), rp))
    model = {}
    for ck, us in units.items():
        if len(us) < CHAIN_MIN_UNITS: continue
        tiers = [u[0] for u in us]; rends = [u[1] for u in us]
        if len(set(rends)) < 2: continue
        rho = _spearman(tiers, rends)
        model[ck] = {'n': len(us), 'rho': round(rho,3),
                     'med_tier': st.median(tiers), 'med_renda': st.median(rends),
                     'prices_by_renda': rho >= CHAIN_RHO}
    return model

def run(cidade):
    cfg = CIDADES[cidade]
    tp, idx, macro, excl_tier, _ = load_common()
    # renda de TODAS as cidades com dado (p/ modelo de rede nacional) + a cidade-alvo
    # renda como PERCENTIL dentro de cada cidade (comparavel entre R$ e salarios minimos)
    renda_pct_slugs = {}
    for f in ['sao-paulo-sp.json','rio-de-janeiro-rj.json','porto-alegre-rs.json']:
        c = json.load(open(os.path.join(R,"data","geo","bairros",f), encoding='utf-8'))
        vals = [(b['slug'], b.get('renda_pc') if b.get('renda_pc') is not None else b.get('renda_media_sm'), b.get('match_slugs',[]))
                for b in c['bairros']]
        vals = [(s,v,ms) for s,v,ms in vals if v is not None]
        order = sorted(vals, key=lambda x: x[1]); n = len(order)
        for i,(s,v,ms) in enumerate(order):
            pct = i/(n-1) if n>1 else 0.5
            renda_pct_slugs[s] = pct
            for m in ms: renda_pct_slugs.setdefault(m, pct)
    chain_model = build_chain_model(tp, idx, macro, renda_pct_slugs)
    # features REAIS do enriquecimento (comodidades/modalidades/url) p/ filtro data-driven
    ef_path = os.path.join(OUT, 'enrich_features.csv')
    enrich = {}
    if os.path.exists(ef_path):
        import csv as _csv
        for r in _csv.DictReader(open(ef_path, encoding='utf-8')):
            enrich[r['gym_id']] = {
                'health': r['health_signal'] == 'True',
                'url_clinic': r['url_clinic_signal'] == 'True',
                'prem_am': int(r['n_premium_amenities'] or 0),
                'categoria': r.get('categoria_real', ''),
            }
    # renda da cidade-alvo (catalogo)
    cat = json.load(open(os.path.join(R,"data","geo","bairros",cfg['catalogo']), encoding='utf-8'))
    renda_by_slug = {}
    alias = {}
    for b in cat['bairros']:
        s = b['slug']; alias[s] = s
        rp = b.get('renda_pc')
        if rp is None and b.get('renda_media_sm') is not None:
            rp = b['renda_media_sm']          # POA usa salarios minimos
        if rp is not None:
            renda_by_slug[s] = rp
        for m in b.get('match_slugs', []): alias[m] = s

    rows = []
    total = have_bairro = 0
    for g in tp:
        a = g['attributes']
        if cfg['municipio'] not in (a.get('municipios_relacionados') or []): continue
        total += 1
        r = idx.get(g['id'])
        if not r or not r.get('bairro_slug'): continue
        have_bairro += 1
        bslug = r['bairro_slug']
        # tenta direto, senao via alias do catalogo
        rp = renda_by_slug.get(bslug) or renda_by_slug.get(alias.get(bslug, ''))
        if rp is None: continue
        plans = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
        tiers = sorted({p['code'] for p in plans if p['code'] in TIER_ORDER}, key=TIER_ORDER.index)
        if not tiers: continue
        mid = str(a.get('featured_modality_id'))
        rows.append({'gym_id': g['id'], 'nome': a.get('name'), 'bairro_slug': bslug,
            'renda_pc': rp, 'macro': macro.get(mid, 'Outros'), 'tiers': tiers, 'entry_tier': tiers[0],
            'n_tiers': len(tiers)})
    df = pd.DataFrame(rows)
    q = df['renda_pc'].quantile([1/3, 2/3]).values
    df['renda_band'] = df['renda_pc'].apply(lambda x: 'baixa' if x <= q[0] else ('media' if x <= q[1] else 'alta'))
    print(f"[{cfg['nome']}] academias no municipio: {total} | com bairro: {have_bairro} | com renda (dataset final): {len(df)} ({len(df)/total*100:.0f}%)")
    print(f"  tercis renda_pc: baixa<={q[0]:.0f} media<={q[1]:.0f} alta>")

    # peer offer_rate com backoff macro×band -> macro -> band -> global
    def orate(gp):
        return {t: float(gp['tiers'].apply(lambda s: t in s).mean()) for t in TIER_ORDER}, len(gp)
    by_mb = {k: v for k, v in df.groupby(['macro','renda_band'])}
    by_m = {k: v for k, v in df.groupby('macro')}
    by_b = {k: v for k, v in df.groupby('renda_band')}
    all_r, all_n = orate(df)
    def peer(mac, bd):
        g = by_mb.get((mac, bd))
        if g is not None and len(g) >= MIN_PEERS: return (*orate(g), 'macro×renda')
        g = by_m.get(mac)
        if g is not None and len(g) >= MIN_PEERS: return (*orate(g), 'macro')
        g = by_b.get(bd)
        if g is not None and len(g) >= MIN_PEERS: return (*orate(g), 'renda')
        return all_r, all_n, 'global'

    recs = []
    for _, row in df.iterrows():
        rates, npeers, nivel = peer(row['macro'], row['renda_band'])
        offered = set(row['tiers'])
        gaps = [(t, rates[t]) for t in TIER_ORDER if rates[t] >= OFFER_HIGH and t not in offered]
        tier_ex = excl_tier.get(row['macro'], 'volume')
        pos = 'premium_nicho' if (row['entry_tier'] in PREMIUM_ENTRY and (tier_ex in EXCLUSIVITY_TIERS or row['renda_band']=='alta')) else 'low_mid'
        # camada de REDE: rede que precifica por renda + unidade no topo da propria rede = estrategico
        ck = chain_key(row['nome']); cm = chain_model.get(ck)
        upct = renda_pct_slugs.get(row['bairro_slug'], 0.5)   # percentil de renda da unidade (na sua cidade)
        rede_estrategico = bool(cm and cm['prices_by_renda']
            and TIER_ORDER.index(row['entry_tier']) >= cm['med_tier']
            and upct >= cm['med_renda'])
        if rede_estrategico and pos == 'low_mid':
            pos = 'premium_rede'
        # Filtro nº 4 (DATA-DRIVEN, enriquecimento real): entrando so' no topo E
        #  - modalidade Reabilitacao/Fisio/Geriatria OU url de clinica -> estabelecimento de saude
        #  - >=4 comodidades premium (manobrista, lanchonete, spa...) -> facility premium
        # Substitui o antigo regex de nome; usa comodidades/modalidades/url reais.
        e = enrich.get(row['gym_id'], {})
        if row['entry_tier'] in PREMIUM_ENTRY:
            if e.get('health') or e.get('url_clinic') or CLINIC_STRONG.search(norm(row['nome'] or '')):
                pos = 'estabelecimento_saude'
            elif e.get('prem_am', 0) >= 4:
                pos = 'premium_amenities'
        estrat = ('premium_nicho','premium_rede','estabelecimento_saude','premium_amenities')
        score = 0.0 if pos in estrat else round(sum(rt*TIER_WEIGHT[t] for t, rt in gaps), 3)
        gclass = {'premium_nicho':'estrategico_nao_gap','premium_rede':'estrategico_rede',
                  'estabelecimento_saude':'estrategico_clinica','premium_amenities':'estrategico_premium',
                  'low_mid':'gap_real'}[pos]
        recs.append({'gym_id': row['gym_id'], 'nome': row['nome'], 'bairro_slug': row['bairro_slug'],
            'renda_pc': row['renda_pc'], 'renda_band': row['renda_band'], 'macro': row['macro'],
            'tier_exclusividade': tier_ex, 'posicionamento': pos,
            'categoria_real': e.get('categoria',''), 'n_comod_premium': e.get('prem_am',0),
            'health_signal': e.get('health',False), 'url_clinic': e.get('url_clinic',False),
            'rede': ck if cm else '', 'rede_rho': cm['rho'] if cm else '',
            'entry_tier': SH[row['entry_tier']], 'tiers_ofertados': '|'.join(SH[t] for t in row['tiers']),
            'gap_tiers': '|'.join(SH[t] for t,_ in gaps), 'n_gaps': len(gaps),
            'gap_class': gclass,
            'gap_score': score, 'peer_n': npeers, 'peer_backoff': nivel})
    gaps_df = pd.DataFrame(recs).sort_values('gap_score', ascending=False)
    gaps_df.to_csv(os.path.join(OUT, f'gym_gap_recommendations_{cidade}.csv'), index=False, encoding='utf-8')

    # matriz modalidade × tier + renda × tier
    def offmat(by):
        ks = sorted(df[by].unique())
        return pd.DataFrame([[df[df[by]==k]['tiers'].apply(lambda s: t in s).mean() for t in TIER_ORDER] for k in ks],
                            index=ks, columns=[SH[t] for t in TIER_ORDER])
    offmat('macro').round(3).to_csv(os.path.join(OUT, f'modality_tier_offer_{cidade}.csv'))
    offmat('renda_band').reindex(['baixa','media','alta']).round(3).to_csv(os.path.join(OUT, f'renda_tier_offer_{cidade}.csv'))

    print(f"  gaps: {(gaps_df['n_gaps']>0).sum()}/{len(gaps_df)} | posicionamento: {dict(gaps_df['posicionamento'].value_counts())}")
    print(f"  backoff: {dict(gaps_df['peer_backoff'].value_counts())}")
    real = gaps_df[gaps_df['gap_class']=='gap_real']
    print(f"\n  === TOP 6 gap REAL {cfg['nome']} ===")
    print(real.head(6)[['nome','bairro_slug','renda_band','macro','tiers_ofertados','gap_tiers','gap_score']].to_string(index=False))

    # heatmap modalidade×tier
    m = offmat('macro')
    fig, ax = plt.subplots(figsize=(11, max(3,0.5*len(m)+1)), dpi=130)
    im = ax.imshow(m.values, cmap='viridis', vmin=0, vmax=1, aspect='auto')
    ax.set_xticks(range(m.shape[1])); ax.set_xticklabels(m.columns, rotation=45, ha='right', fontsize=8)
    ax.set_yticks(range(m.shape[0])); ax.set_yticklabels(m.index, fontsize=8)
    for i in range(m.shape[0]):
        for j in range(m.shape[1]):
            v=m.values[i,j]; ax.text(j,i,f'{v:.2f}',ha='center',va='center',fontsize=6,color='white' if v<0.6 else 'black')
    plt.colorbar(im, label='offer_rate'); ax.set_title(f'{cfg["nome"]}: offer_rate modalidade × tier')
    plt.tight_layout(); plt.savefig(os.path.join(OUT, f'heatmap_modalidade_tier_{cidade}.png')); plt.close()
    return gaps_df

if __name__ == '__main__':
    c = sys.argv[1] if len(sys.argv) > 1 else 'sp'
    run(c)
