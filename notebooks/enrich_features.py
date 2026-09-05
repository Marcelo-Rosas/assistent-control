"""
Extrai features REAIS do enriquecimento TotalPass (data/processed/totalpass-enriched/by-id)
para as academias do recomendador: comodidades, modalidades, categoria, url.
Deriva sinais data-driven p/ o filtro de falso-positivo (premium / saude), substituindo
o regex de nome. Saida: data/processed/recomendador-poa/enrich_features.csv
"""
import os, json, re, unicodedata
import pandas as pd

R = r"C:\Users\marce\assistent-control"
ED = os.path.join(R, "data", "processed", "totalpass-enriched", "by-id")
OUT = os.path.join(R, "data", "processed", "recomendador-poa")

def norm(t):
    t = unicodedata.normalize('NFD', str(t).lower())
    return ''.join(c for c in t if unicodedata.category(c) != 'Mn')

# comodidades que sinalizam posicionamento PREMIUM (conforto/servico de alto padrao)
PREMIUM_AMENITIES = {norm(x) for x in [
    'Manobrista','Lanchonete','Toalhas','Cadeira de massagem','Smart SPA','Climatizador',
    'Chapinha para Cabelos','Secador de cabelo','Estacionamento Conveniado','Espaço Kids',
    'Vestiário Infantil','Banheiro Infantil','Loja']}
# modalidades/categorias que sinalizam SAUDE/REABILITACAO (gym acessorio de negocio de saude)
HEALTH_TERMS = re.compile(r'reabilita|fisioterap|geriatr|pilates cl|clinic|ortoped|postur|rpg|osteo')
# sinal de CLINICA na url (razao social) — ex.: vivedouro-geriatria-ltda
URL_CLINIC = re.compile(r'geriatr|clinic|saude|reabilita|instituto|ortoped|fisioterap|medic|odonto|hospital')

def load_ids():
    ids = set()
    for c in ['sp','rj']:
        p = os.path.join(OUT, f"gym_gap_recommendations_{c}.csv")
        if os.path.exists(p): ids |= set(pd.read_csv(p)['gym_id'])
    return ids

def main():
    ids = load_ids()
    rows = []
    for gid in ids:
        p = os.path.join(ED, f"{gid}.json")
        if not os.path.exists(p): continue
        d = json.load(open(p, encoding='utf-8')).get('detail', {})
        mods = d.get('modalidades') or []
        mep = d.get('modalidades_e_planos') or []
        cats = {m.get('categoria','').strip() for m in mep}
        com = d.get('comodidades') or []
        com_n = {norm(x) for x in com}
        url = d.get('url') or ''
        blob = norm(' '.join(mods) + ' ' + ' '.join(cats))
        prem_am = com_n & PREMIUM_AMENITIES
        rows.append({
            'gym_id': gid,
            'categoria_real': ' | '.join(sorted(c for c in cats if c)),
            'n_modalidades': len(mods),
            'n_comodidades': len(com),
            'n_premium_amenities': len(prem_am),
            'premium_amenities': ', '.join(sorted(prem_am)),
            'health_signal': bool(HEALTH_TERMS.search(blob)),
            'url_clinic_signal': bool(URL_CLINIC.search(norm(url))),
            'url': url,
        })
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(OUT, 'enrich_features.csv'), index=False, encoding='utf-8')
    print(f"features extraidas: {len(df)} academias")
    print("com health_signal (reabilita/fisio/geriatria):", int(df['health_signal'].sum()))
    print("com url_clinic_signal:", int(df['url_clinic_signal'].sum()))
    print("distribuicao n_premium_amenities:", dict(df['n_premium_amenities'].value_counts().sort_index()))

if __name__ == '__main__':
    main()
