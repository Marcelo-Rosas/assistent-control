"""Superficie MRLR como Scalars — auditoria da extrapolacao geografica (adaptacao GymSite).
Loga Valor Unitario (R$/m2) vs AREA (200..3000 m2) para combos porte x padrao representativos.
Mostra o efeito de ln(area) (VU cai com area) e a sensibilidade a padrao/porte. Aba SCALARS.
HONESTIDADE: calibracao Goias -> nacional e extrapolacao; local=2; serve p/ AUDITAR, nao vender.
"""
import os
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
import tensorflow as tf
from mrlr_aluguel import valor_unitario_mrlr

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "tb_logs", "all_plugins")  # junta na aba Scalars existente
os.makedirs(LOG, exist_ok=True)

# combos representativos: (label, padrao, porte, fator, pib_reais)
PIB_CAP = 100_000_000_000   # capital grande
PIB_MED = 5_000_000_000     # cidade media
combos = [
    ("mrlr_surface/capital_padrao_alto", 3, 4, 2, PIB_CAP),
    ("mrlr_surface/capital_padrao_baixo", 1, 4, 2, PIB_CAP),
    ("mrlr_surface/cidade_media_padrao_medio", 2, 3, 1, PIB_MED),
    ("mrlr_surface/interior_padrao_baixo", 1, 1, 1, PIB_MED),
]
w = tf.summary.create_file_writer(LOG)
with w.as_default():
    for area in range(200, 3001, 50):
        for tag, padrao, porte, fator, pib in combos:
            vu = valor_unitario_mrlr(float(area), padrao, 2, porte, float(pib), fator)
            if vu is not None:
                tf.summary.scalar(tag, vu, step=area)
    w.flush()
print(f"MRLR surface logada em {LOG} (aba Scalars, tags mrlr_surface/*) — VU vs area 200..3000 m2")
