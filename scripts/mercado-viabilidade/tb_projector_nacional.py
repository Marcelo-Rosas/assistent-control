"""
Projector NACIONAL (30.701 academias) com metadata categorica rica.
color_by nomeado: regiao, macro_v2 (Outros resolvido), faixa_preco_tier, faixa_renda,
tipo_rede (nacional/regional/unica), nivel_comodidades, categoria_estab, perfil_academia,
cidade, uf, gap_class (SP/RJ). Escopo: so' visualizacao.
"""
import json, os, re, unicodedata
import numpy as np, pandas as pd
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','2')
import tensorflow as tf
from tensorboard.plugins import projector
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

R = r"C:\Users\marce\assistent-control"
ED = os.path.join(R, "data", "processed", "totalpass-enriched", "by-id")
OUT = os.path.join(R, "data", "processed", "recomendador-poa")
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "tb_logs", "nacional")
os.makedirs(LOG, exist_ok=True)

def norm(t):
    t = unicodedata.normalize('NFD', str(t).lower())
    return ''.join(c for c in t if unicodedata.category(c) != 'Mn')

TIER = ['plan_tp_free','plan_tp_free_indirects','plan_tp0','plan_tp1','plan_tp1_plus','plan_tp2',
        'plan_tp2_plus','plan_tp3','plan_tp4','plan_tp5','plan_tp5_plus','plan_tp6','plan_tp7']
TI = {c:i for i,c in enumerate(TIER)}
SH = {c: c.replace('plan_tp','TP').replace('_plus','+').replace('_free_indirects','Fi').replace('_free','F').upper() for c in TIER}

# --- UF -> regiao ---
REG = {'Norte':'AC AP AM PA RO RR TO','Nordeste':'AL BA CE MA PB PE PI RN SE',
       'Centro-Oeste':'DF GO MT MS','Sudeste':'ES MG RJ SP','Sul':'PR RS SC'}
UF2REG = {u:r for r,us in REG.items() for u in us.split()}

# --- macro map ---
import csv as _csv
MACRO = {str(r['id']): r['macro_grupo'] for r in _csv.DictReader(open(os.path.join(OUT,'modality_id_macro.csv'),encoding='utf-8'))}

# --- resolucao de "Outros" por modalidade real ---
OUTROS_REMAP = [
    (re.compile(r'muay|jiu|jitsu|boxe|luta|karate|judo|taekwondo|mma'), 'Lutas'),
    (re.compile(r'fit dance|jazz|ballet|bale|zumba|ritmo|forro|danca|dance|sapateado|pole'), 'Danca'),
    (re.compile(r'funcional|circuito|crossfit|cross training'), 'Funcional'),
    (re.compile(r'pilates|fisioterap|reabilita|rpg|postur'), 'Pilates & Fisio'),
    (re.compile(r'yoga|meditac'), 'Yoga'),
    (re.compile(r'bike|spinning|indoor cycling|ciclismo'), 'Bike Indoor'),
    (re.compile(r'natacao|hidro|aqua|swim'), 'Natacao'),
    (re.compile(r'beach|futevolei|volei|tennis|tenis'), 'Beach Sports'),
    (re.compile(r'corrida|run|assessoria esport'), 'Corrida'),
    (re.compile(r'musculacao'), 'Musculacao'),
]
def resolve_outros(modalidades):
    blob = norm(' '.join(modalidades or []))
    for rx, mac in OUTROS_REMAP:
        if rx.search(blob): return mac
    return 'Outros'

# --- comodidades taxonomia ---
PREM_AM = {norm(x) for x in ['Smart SPA','Sauna','Cadeira de massagem','Manobrista']}
CONF_AM = {norm(x) for x in ['Lanchonete','Loja','Toalhas','Secador de cabelo','Chapinha para Cabelos','Ar Condicionado','Climatizador','Estacionamento Conveniado']}
EXTRA_AM = {norm(x) for x in ['Ar Condicionado','Climatizador','Ventilador','Estacionamento Pago','Estacionamento Gratis','Estacionamento Conveniado','Bicicletario','Secador de cabelo','Toalhas','Chapinha para Cabelos']}
def nivel_comod(com):
    cn = {norm(x) for x in com}
    if cn & PREM_AM: return 'Premium'
    if len(cn & CONF_AM) >= 3: return 'Conforto'
    if cn & EXTRA_AM: return 'Padrao'
    return 'Basico'

HEALTH = re.compile(r'reabilita|fisioterap|geriatr|pilates cl|clinic|ortoped|postur|rpg|osteo')
URLCL = re.compile(r'geriatr|clinic|saude|reabilita|instituto|ortoped|fisioterap|medic|odonto|hospital')

# --- renda NACIONAL (renda-bairro-nacional.json) por (ibge, bairro_slug) ---
def _slug(s):
    s = unicodedata.normalize('NFD', str(s).lower()); s=''.join(c for c in s if unicodedata.category(c)!='Mn'); return re.sub(r'[^a-z0-9]+','-',s).strip('-')
renda_nac = json.load(open(os.path.join(R,'data','processed','renda-bairro-nacional.json'),encoding='utf-8'))
renda_ib = {}
for ibge, bl in renda_nac.items():
    for b, rp in bl.items(): renda_ib[(ibge, _slug(b))] = rp
# --- aluguel MRLR NACIONAL (adaptacao GymSite) por (ibge, bairro_slug) ---
alug_nac = json.load(open(os.path.join(R,'data','processed','aluguel-mrlr-nacional.json'),encoding='utf-8'))
alug_ib = {}
for ibge, bl in alug_nac.items():
    if ibge == '_meta': continue
    for b, v in bl.items(): alug_ib[(ibge, _slug(b))] = v['vu_m2']
_muns = json.load(open(os.path.join(R,'data','municipios-brasil.json'),encoding='utf-8'))
_m2i = {(norm(m['nome']),m['uf']):m['ibge'] for m in _muns}
idx = json.load(open(os.path.join(R,'data','processed','tp-bairro-index.json'),encoding='utf-8'))['by_gym_id']

# --- gap_class NACIONAL (do recomendador_nacional) ---
gapcls = {}
p = os.path.join(OUT, 'gym_gap_recommendations_nacional.csv')
if os.path.exists(p):
    for _, r in pd.read_csv(p).iterrows(): gapcls[r['gym_id']] = r['gap_class']

STOP = set('academia fitness gym studio unidade centro club clube de da do e a o'.split())
# remove sufixos de unidade/local p/ isolar a marca, depois usa 2 primeiros tokens (preciso)
UNIT_WORDS = re.compile(r'\b(unidade|unid|filial|loja|shopping|vila|jardim|parque|centro|zona|bairro|rua|av|avenida)\b.*$')
def brand_root(nome):
    n = UNIT_WORDS.sub('', norm(nome)).strip()
    toks = [w for w in re.sub(r'[^a-z0-9 ]',' ',n).split() if w and w not in STOP]
    return ' '.join(toks[:2]) if toks else ''

# ---- passe 1: carregar tudo + contar redes ----
tp = json.load(open(os.path.join(R,'data','raw','totalpass-brasil-all.json'),encoding='utf-8'))['data']
from collections import defaultdict, Counter
brand_mun = defaultdict(Counter)
recs = []
for g in tp:
    a = g['attributes']
    plans = [p for p in (a.get('accessible_on_plans') or []) if p.get('price') is not None]
    tiers = sorted({p['code'] for p in plans if p['code'] in TIER}, key=TIER.index)
    if not tiers: continue
    # enriquecimento
    ep = os.path.join(ED, f"{g['id']}.json")
    mods, com, url = [], [], ''
    if os.path.exists(ep):
        det = json.load(open(ep,encoding='utf-8')).get('detail',{})
        mods = det.get('modalidades') or []; com = det.get('comodidades') or []; url = det.get('url') or ''
    macro0 = MACRO.get(str(a.get('featured_modality_id')), 'Outros')
    macro = resolve_outros(mods) if macro0 == 'Outros' else macro0
    nome = a.get('name') or ''
    br = brand_root(nome); mun = (a.get('municipios_relacionados') or ['?'])[0]
    brand_mun[br][mun] += 1
    recs.append({'gym_id': g['id'], 'nome': nome, 'brand': br, 'uf': a.get('uf'), 'mun': mun,
        'macro': macro, 'entry': tiers[0], 'n_tiers': len(tiers),
        'classes': int(bool(a.get('support_fitness_classes'))),
        'booking': int(bool(re.search(r'agendament|agendar|hora marcada', norm(a.get('warning_message') or '')))),
        'com': com, 'n_com': len(com), 'n_prem': len({norm(x) for x in com} & PREM_AM),
        'mods': mods, 'url': url, 'bairro_slug': (idx.get(g['id'],{}) or {}).get('bairro_slug'),
        'ibge': _m2i.get((norm(mun), a.get('uf')))})
df = pd.DataFrame(recs)
print(f"academias com plano: {len(df)}")

# tipo_rede
def tipo_rede(br):
    mm = brand_mun[br]; ncid = len(mm); tot = sum(mm.values())
    if not br: return 'unica'
    if ncid >= 2: return 'nacional'
    if tot > 3: return 'regional'
    return 'unica'
df['tipo_rede'] = df['brand'].map(tipo_rede)

# regiao, faixa preco, nivel comod, categoria, renda
df['regiao'] = df['uf'].map(lambda u: UF2REG.get(u, 'Outro'))
def faixa_preco(e):
    i = TI[e]
    if i <= TI['plan_tp2']: return 'Economico'
    if i <= TI['plan_tp4']: return 'Intermediario'
    if i <= TI['plan_tp5_plus']: return 'Alto'
    return 'Premium'
df['faixa_preco'] = df['entry'].map(faixa_preco)
df['nivel_comod'] = df['com'].map(nivel_comod)
def categoria_estab(r):
    blob = norm(' '.join(r['mods'] or []))
    if HEALTH.search(blob) or URLCL.search(norm(r['url'] or '')): return 'clinica'
    if r['nivel_comod'] == 'Premium' and r['macro'] in ('Spa & Estetica','Outros'): return 'spa_premium'
    return 'academia'
df['categoria_estab'] = df.apply(categoria_estab, axis=1)
# faixa_renda: resolver de cobertura ~100% (bairro exato -> fuzzy -> mediana municipio), sem 'sem dado'
from bairro_resolver import Resolver
_RV = Resolver()
def _resolve_row(r):
    if not r['ibge']:
        return (None, None, 'sem_ibge')
    fr = _RV.full(r['ibge'], r['bairro_slug'] or r.get('bairro') or '')
    return (fr['renda_pc'], fr['vu_m2'], fr['match_level'])
_res = df.apply(_resolve_row, axis=1)
df['renda_pc'] = [x[0] for x in _res]
df['vu_m2'] = [x[1] for x in _res]
df['match_renda'] = [x[2] for x in _res]
def _pct(v):
    return v.rank(pct=True) if v.notna().sum() >= 4 else pd.Series(np.nan, index=v.index)
df['renda_pct'] = df.groupby('mun')['renda_pc'].transform(_pct)
def _lab(p):
    if pd.isna(p): return 'sem dado'
    return ['Baixa','Media-baixa','Media-alta','Alta'][min(int(p*4),3)]
df['faixa_renda'] = df['renda_pct'].map(_lab)
# fallback: cidades com <4 academias (percentil indefinido) -> quartil NACIONAL da renda, nunca 'sem dado'
_nq = np.quantile(df['renda_pc'].dropna(), [.25, .5, .75]) if df['renda_pc'].notna().any() else [0, 0, 0]
def _natlab(v):
    if pd.isna(v): return 'sem dado'
    return 'Baixa' if v <= _nq[0] else 'Media-baixa' if v <= _nq[1] else 'Media-alta' if v <= _nq[2] else 'Alta'
_mask = df['faixa_renda'] == 'sem dado'
df.loc[_mask, 'faixa_renda'] = df.loc[_mask, 'renda_pc'].map(_natlab)
# faixa_aluguel: quartis NACIONAIS do VU MRLR (R$/m2, do resolver) -> Baixo/Medio/Alto/Premium
_vu_ok = df['vu_m2'].dropna()
_aq = np.quantile(_vu_ok, [.25,.5,.75]) if len(_vu_ok) >= 4 else [0,0,0]
def _alab(v):
    if pd.isna(v): return 'sem dado'
    return 'Baixo' if v<=_aq[0] else 'Medio' if v<=_aq[1] else 'Alto' if v<=_aq[2] else 'Premium'
df['faixa_aluguel'] = df['vu_m2'].map(_alab)
# perfil_academia (sintese, precedencia)
NICHO = {'Spa & Estetica','EMS'}; BOUTIQUE = {'Pilates & Fisio','Yoga','Personal (CNPJ)','Danca','Bike Indoor'}
def perfil(r):
    if r['macro'] in NICHO: return 'nicho'
    if r['macro'] in BOUTIQUE and TI[r['entry']] >= TI['plan_tp4']: return 'boutique'
    if r['nivel_comod'] == 'Premium' or TI[r['entry']] >= TI['plan_tp6']: return 'premium'
    if TI[r['entry']] <= TI['plan_tp2'] and r['n_tiers'] >= 6 and r['nivel_comod'] in ('Basico','Padrao'): return 'low_cost'
    return 'mid_market'
df['perfil'] = df.apply(perfil, axis=1)
df['gap_class'] = df['gym_id'].map(lambda i: gapcls.get(i, 'n/a'))
df['plano_entrada'] = df['entry'].map(SH)                       # plano/tier de entrada real (TP1..TP7)
df['n_planos'] = df['n_tiers'].astype(str)                       # qtd de planos que dao acesso (categorico)

print("macro=Outros restante:", int((df['macro']=='Outros').sum()), "(era 2663)")
print("tipo_rede:", dict(df['tipo_rede'].value_counts()))
print("perfil:", dict(df['perfil'].value_counts()))
print("regiao:", dict(df['regiao'].value_counts()))

# ---- embedding ----
num = df[['n_tiers','classes','booking','n_com','n_prem']].astype(float).copy()
num['entry_idx'] = df['entry'].map(lambda e: TI[e])
oh = pd.get_dummies(df['macro'], prefix='m').astype(int)
X = StandardScaler().fit_transform(pd.concat([num, oh], axis=1).values).astype('float32')
Z = PCA(n_components=8, random_state=42).fit_transform(X).astype('float32')
rng = np.random.default_rng(42)
Z = Z + rng.normal(0, 0.02*Z.std(0, keepdims=True), Z.shape).astype('float32')

emb = tf.Variable(Z, name='nacional_embedding')
tf.train.Checkpoint(embedding=emb).save(os.path.join(LOG,'embedding.ckpt'))
cols = ['perfil','plano_entrada','n_planos','regiao','macro','faixa_preco','faixa_renda','faixa_aluguel','match_renda','tipo_rede','nivel_comod','categoria_estab','gap_class','uf','mun','nome']
with open(os.path.join(LOG,'metadata.tsv'),'w',encoding='utf-8') as f:
    f.write('\t'.join(cols)+'\n')
    for _, r in df.iterrows():
        vals = [str(r[c]).replace('\t',' ').replace('\n',' ')[:40] for c in cols]
        f.write('\t'.join(vals)+'\n')
cfg = projector.ProjectorConfig(); ep = cfg.embeddings.add()
ep.tensor_name = "embedding/.ATTRIBUTES/VARIABLE_VALUE"; ep.metadata_path = os.path.join(LOG,'metadata.tsv')
projector.visualize_embeddings(LOG, cfg)
print(f"\nOK: {len(df)} academias no projector nacional | logdir: {LOG}")
