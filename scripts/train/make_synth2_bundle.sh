#!/usr/bin/env bash
# Code + synth v2 rows for notebooks/train_synth2_colab.ipynb -> outputs/lifemate_synth2_bundle.zip (upload to Drive as
# lifemate_synth2/bundle.zip). Holds TRAIN-derived rows only (data_full_e1, synth_v2_rows), never public data.
# data_full_e1 is rebuilt as in the README: original Gipformer cache of TRAIN audio, then
#   scripts/infer/asr_cache.py --split train --output-dir outputs/asr/gipformer_train
#   scripts/data/prepare_agent_sft.py --orchestration E1 --variants gold,asr --include-validation --output-dir outputs/sft/data_full_e1
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f outputs/sft/data_full_e1/train.jsonl || { echo "build outputs/sft/data_full_e1 first (see header)" >&2; exit 1; }
test -f outputs/sft/synth_v2_rows/train.jsonl || { echo "build first: scripts/data/build_synth_split.py --out outputs/synth_v2 --history-rate 0.6, then prepare_agent_sft.py --split synth" >&2; exit 1; }
rm -f outputs/lifemate_synth2_bundle.zip
python - <<'PY'
import zipfile, pathlib
root = pathlib.Path('.')
with zipfile.ZipFile('outputs/lifemate_synth2_bundle.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for top in ('src', 'scripts', 'configs'):
        for f in (root / top).rglob('*'):
            if f.is_file() and '__pycache__' not in f.parts:
                z.write(f, f.as_posix())
    z.write('pyproject.toml', 'pyproject.toml')
    for d in ('outputs/sft/synth_v2_rows', 'outputs/sft/data_full_e1'):
        for f in ('train.jsonl', 'dev.jsonl', 'manifest.json'):
            z.write(f'{d}/{f}', f'{d}/{f}')
print('ok', pathlib.Path('outputs/lifemate_synth2_bundle.zip').stat().st_size // 1024, 'KB')
PY
