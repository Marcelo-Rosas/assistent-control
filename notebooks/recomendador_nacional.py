"""
Recomendador de planos — ESCOPO MAXIMO NACIONAL.
Renda por bairro NACIONAL (renda_bairro-nacional.json, 186 munis / 6039 bairros,
fonte Supabase cargo-flow-navigator, IBGE Censo 2022). Join gym -> ibge (municipios-brasil)
+ bairro (tp-bairro-index) -> renda. Peer-benchmark macro x renda_band por cidade (backoff
regiao/global) + os 4 filtros (exclusividade nacional, renda, rede multi-marca, clinica/premium
enriquecido). Saida: gym_gap_recommendations_nacional.csv.
"""
import json, os, re, unicodedata, csv as _csv
import numpy as np, pandas as pd

R = r"C:\Users\marce\assistent-control"
OUT = os.path.join(R, "data", "processed", "recomendador-poa")
ED = os.path.join(R, "data", "processed", "totalpass-enriched", "by-id")
TIER = ['plan_tp_free','plan_tp_free_indirects','plan_tp0','plan_tp1','plan_tp1_plus','plan_tp2',
        'plan_tp2_plus','plan_tp3','plan_tp4','plan_tp5','plan_tp5_plus','plan_tp6','plan_tp7']
TI = {c:i for i,c in enumerate(TIER)}
SH = {c: c.replace('plan_tp','TP').replace('_plus','+').replace('_free_indirects','Fi').replace('_free','F').upper() for c in TIER}
TIER_WEIGHT = {c: 1.0 + max(0,(8-i))*0.1 for i,c in enumerate(TIER)}
MIN_PEERS, OFFER_HIGH = 15, 0.60
PREMIUM_ENTRY = {'plan_tp6','plan_tp7'}
EXCL_TIERS = {'nativa','propensa'}
NICHO_BOUT = None
BOOKING = re.compile(r'agendament|agendar|hora marcada|marcar hor[ao]rio|reserv[ae]r? (o )?hor[ao]rio')
CLINIC_STRONG = re.compile(r'clinic|integrad|instituto|multidisciplin|reabilita|policlinic|hospital|\bmedic|odonto|ortoped|oncolog|oncomover|centro medic|saude integrad')
HEALTH = re.compile(r'reabilita|fisioterap|geriatr|pilates cl|clinic|ortoped|postur|rpg|osteo')
URLCL = re.compile(r'geriatr|clinic|saude|reabilita|instituto|ortoped|fisioterap|medic|odonto|hospital')
PREM_AM = None
REG = {'Norte':'AC AP AM PA RO RR TO','Nordeste':'AL BA CE MA PB PE PI RN SE','Centro-Oeste':'DF GO MT MS','Sudeste':'ES MG RJ SP','Sul':'PR RS SC'}
UF2REG = {u:r for r,us in REG.items() for u in us.split()}

def norm(t):
    t = unicodedata.normalize('NFD', str(t).lower()); return ''.join(c for c in t if unicodedata.category(c) != 'Mn')
def slug(s):
    return re.sub(r'[^a-z0-9]+','-', norm(s)).strip('-')

def main():
    tp = json.load(open(os.path.join(R,'data','raw','totalpass-brasil-all.json'),encoding='utf-8'))['data']
    idx = json.load(open(os.path.join(R,'data','processed','tp-bairro-index.json'),encoding='utf-8'))['by_gym_id']
    muns = json.load(open(os.path.join(R,'data','municipios-brasil.json'),encoding='utf-8'))
    m2i = {(norm(m['nome']),m['uf']):m['ibge'] for m in muns}
    renda_nac = json.load(open(os.path.join(R,'data','processed','renda-bairro-nacional.json'),encoding='utf-8'))
    # renda por (ibge, bairro_slug)
    renda = {}
    for ibge, bl in renda_nac.items():
        for b, r in bl.items(): renda[(ibge, slug(b))] = r
    macro = {str(r['id']): r['macro_grupo'] for r in _csv.DictReader(open(os.path.join(OUT,'modality_id_macro.csv'),encoding='utf-8'))}
    excl = json.load(open(os.path.join(OUT,'modality_exclusivity_model.json'),encoding='utf-8'))
    excl_tier = {m:v['tier'] for m,v in excl['modalidades'].items()}
    # enriquecimento features (comodidades/health/url) — ja calculado p/ SP+RJ; p/ nacional lemos on-demand
    global PREM_AM
    PREM_AM = {norm(x) for x in ['Smart SPA','Sauna','Cadeira de massagem','Manobrista']}

    rows = []
    total = elig = comrenda = 0
    for g in tp:
        a = g['attributes']; total += 1
        r = idx.get(g['id']); bslug = r.get('bairro_slug') if r else None
        mun = (a.get('municipios_relacionados') or [None])[0]; uf = a.get('uf')
        ibge = m2i.get((norm(mun),uf)) if mun and uf else None
        if not (bslug and ibge): continue
        elig += 1
        rp = renda.get((ibge, bslug))
        if rp is None: continue
        comrenda += 1
        plans = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
        tiers = sorted({p['code'] for p in plans if p['code'] in TIER}, key=TIER.index)
        if not tiers: continue
        # enriquecimento
        ep = os.path.join(ED, f"{g['id']}.json"); mods=[]; com=[]; url=''
        if os.path.exists(ep):
            det = json.load(open(ep,encoding='utf-8')).get('detail',{})
            mods = det.get('modalidades') or []; com = det.get('comodidades') or []; url = det.get('url') or ''
        rows.append({'gym_id': g['id'], 'nome': a.get('name'), 'cidade': mun, 'uf': uf,
            'regiao': UF2REG.get(uf,'Outro'), 'renda_pc': rp, 'macro': macro.get(str(a.get('featured_modality_id')),'Outros'),
            'tiers': tiers, 'entry_tier': tiers[0], 'n_tiers': len(tiers),
            'health': bool(HEALTH.search(norm(' '.join(mods)))) or bool(URLCL.search(norm(url))),
            'n_prem_am': len({norm(x) for x in com} & PREM_AM)})
    df = pd.DataFrame(rows)
    print(f"total={total} | elegivel(bairro+ibge)={elig} ({elig/total*100:.0f}%) | com renda={comrenda} ({comrenda/total*100:.0f}%) | no dataset={len(df)}")

    # renda_band tercis por cidade (backoff regiao se <6 academias na cidade)
    def bands(sub):
        v = sub['renda_pc']
        grp = sub['cidade'] if len(sub) >= 6 else sub['regiao']
        return v
    # simplifica: tercis por cidade quando >=6 senao por regiao
    df['renda_rank_city'] = df.groupby('cidade')['renda_pc'].transform(lambda v: v.rank(pct=True) if len(v)>=6 else np.nan)
    df['renda_rank_reg'] = df.groupby('regiao')['renda_pc'].transform(lambda v: v.rank(pct=True))
    df['renda_rank'] = df['renda_rank_city'].fillna(df['renda_rank_reg'])
    df['renda_band'] = df['renda_rank'].map(lambda p: 'baixa' if p<=1/3 else ('media' if p<=2/3 else 'alta'))

    # ---- peer offer_rate com backoff macro×band -> macro -> regiao×band -> global ----
    def orate(gp): return {t: float(gp['tiers'].apply(lambda s: t in s).mean()) for t in TIER}, len(gp)
    by_mb = {k:v for k,v in df.groupby(['macro','renda_band'])}
    by_m = {k:v for k,v in df.groupby('macro')}
    by_rb = {k:v for k,v in df.groupby(['regiao','renda_band'])}
    allr, alln = orate(df)
    def peer(mac, bd, reg):
        for key,tbl in [((mac,bd),by_mb),(mac,by_m),((reg,bd),by_rb)]:
            g = tbl.get(key)
            if g is not None and len(g) >= MIN_PEERS: return orate(g)[0], len(g)
        return allr, alln

    # ---- rede: raiz de marca 2 tokens + strip unidade ----
    STOP = set('academia fitness gym studio unidade centro club clube de da do e a o'.split())
    UNIT = re.compile(r'\b(unidade|unid|filial|loja|shopping|vila|jardim|parque|centro|zona|bairro|rua|av|avenida)\b.*$')
    def brand(n):
        n = UNIT.sub('', norm(n)).strip(); toks=[w for w in re.sub(r'[^a-z0-9 ]',' ',n).split() if w and w not in STOP]
        return ' '.join(toks[:2]) if toks else ''
    from collections import Counter, defaultdict
    bmun = defaultdict(Counter)
    for _,r in df.iterrows(): bmun[brand(r['nome'])][r['cidade']] += 1
    def _spear(xs,ys):
        n=len(xs)
        if n<3: return 0.0
        def rk(v):
            o=sorted(range(len(v)),key=lambda i:v[i]); r=[0.0]*len(v); i=0
            while i<len(v):
                j=i
                while j+1<len(v) and v[o[j+1]]==v[o[i]]: j+=1
                a=(i+j)/2+1
                for k in range(i,j+1): r[o[k]]=a
                i=j+1
            return r
        rx,ry=rk(xs),rk(ys); mx=sum(rx)/n; my=sum(ry)/n
        num=sum((a-mx)*(b-my) for a,b in zip(rx,ry)); den=(sum((a-mx)**2 for a in rx)*sum((b-my)**2 for b in ry))**.5
        return num/den if den else 0.0
    # rho tier×renda_pct por marca (>=3 un)
    chain = {}
    for br, grp in df.assign(brand=df['nome'].map(brand)).groupby('brand'):
        if len(grp) < 3 or grp['renda_pc'].nunique() < 2: continue
        tiers = [TI[e] for e in grp['entry_tier']]; rends = list(grp['renda_pc'])
        chain[br] = {'rho': _spear(tiers, rends), 'med_tier': np.median(tiers),
                     'med_renda_pct': grp['renda_rank'].median()}
    def tipo_rede(br):
        mm=bmun[br]; return 'nacional' if len(mm)>=2 else ('regional' if sum(mm.values())>3 else 'unica')

    recs = []
    for _, row in df.iterrows():
        rates, npeers = peer(row['macro'], row['renda_band'], row['regiao'])
        offered = set(row['tiers'])
        gaps = [(t,rates[t]) for t in TIER if rates[t] >= OFFER_HIGH and t not in offered]
        tier_ex = excl_tier.get(row['macro'],'volume')
        br = brand(row['nome']); cm = chain.get(br)
        pos = 'premium_nicho' if (row['entry_tier'] in PREMIUM_ENTRY and (tier_ex in EXCL_TIERS or row['renda_band']=='alta')) else 'low_mid'
        if pos=='low_mid' and cm and cm['rho']>=0.30 and TI[row['entry_tier']]>=cm['med_tier'] and (row['renda_rank'] or 0)>=cm['med_renda_pct']:
            pos='premium_rede'
        if row['entry_tier'] in PREMIUM_ENTRY:
            if row['health'] or CLINIC_STRONG.search(norm(row['nome'] or '')): pos='estabelecimento_saude'
            elif row['n_prem_am']>=4: pos='premium_amenities'
        estrat=('premium_nicho','premium_rede','estabelecimento_saude','premium_amenities')
        score = 0.0 if pos in estrat else round(sum(rt*TIER_WEIGHT[t] for t,rt in gaps),3)
        gclass = {'premium_nicho':'estrategico_nao_gap','premium_rede':'estrategico_rede',
                  'estabelecimento_saude':'estrategico_clinica','premium_amenities':'estrategico_premium','low_mid':'gap_real'}[pos]
        recs.append({'gym_id':row['gym_id'],'nome':row['nome'],'cidade':row['cidade'],'uf':row['uf'],'regiao':row['regiao'],
            'renda_pc':row['renda_pc'],'renda_band':row['renda_band'],'macro':row['macro'],'tier_exclusividade':tier_ex,
            'tipo_rede':tipo_rede(br),'posicionamento':pos,'gap_class':gclass,
            'entry_tier':SH[row['entry_tier']],'tiers_ofertados':'|'.join(SH[t] for t in row['tiers']),
            'gap_tiers':'|'.join(SH[t] for t,_ in gaps),'n_gaps':len(gaps),'gap_score':score,'peer_n':npeers})
    g = pd.DataFrame(recs).sort_values('gap_score',ascending=False)
    g.to_csv(os.path.join(OUT,'gym_gap_recommendations_nacional.csv'), index=False, encoding='utf-8')
    print("\ngap_class:", dict(g['gap_class'].value_counts()))
    print("cobertura renda por regiao:")
    print(df.groupby('regiao').size().to_string())
    print("\n=== TOP 8 gap_real nacional ===")
    print(g[g['gap_class']=='gap_real'].head(8)[['nome','cidade','uf','macro','entry_tier','gap_tiers','gap_score']].to_string(index=False))

if __name__ == '__main__':
    main()
