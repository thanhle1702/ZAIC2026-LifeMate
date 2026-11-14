"""Pinned inference-only download: original Qwen3.5 base + released p1/Gipformer.

No training, no model execution, no ensemble adapters or redundant original ASR.
Install huggingface_hub in the isolated local environment before running.
"""
import hashlib
import json
import os
from pathlib import Path

os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[2]
RELEASE = '02080970ccd59a2e1aeec4fd66a17640da2cddf1'
BASE = '851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a'


def main():
    release = ROOT/'outputs/release/lifemate-final'
    print('Downloading released ASR + p1 adapter (resume supported)', flush=True)
    snapshot_download('hugebenevolence/lifemate-final', revision=RELEASE, local_dir=release,
        allow_patterns=['README.md', 'SHA256SUMS', 'asr-gipformer/*', 'llm-lora-p1/*'], max_workers=2)
    checked = []
    for line in (release/'SHA256SUMS').read_text().splitlines():
        sha, name = line.split(maxsplit=1); name = name.lstrip('*').removeprefix('./')
        if not name.startswith(('asr-gipformer/', 'llm-lora-p1/')): continue
        path = (release/name).resolve()
        if not path.is_relative_to(release.resolve()): raise ValueError('Unsafe checksum path')
        h = hashlib.sha256()
        with path.open('rb') as f:
            for block in iter(lambda:f.read(1024**2),b''): h.update(block)
        if h.hexdigest()!=sha: raise ValueError('Release checksum mismatch: '+name)
        checked.append(name)
    if not checked: raise ValueError('No released file checksum verified')
    print('Released checkpoint checksums verified:', len(checked), flush=True)
    print('Downloading original Qwen3.5-4B base weights', flush=True)
    snapshot_download('Qwen/Qwen3.5-4B', revision=BASE, local_dir=ROOT/'models/qwen3.5-4b', max_workers=2)
    result={'upstream_git':'6ef76e00647bf44e14bcb084b58ef0c503584f55','base_revision':BASE,
        'release_revision':RELEASE,'release_files_checked':checked,'runtime_verified':False,
        'note':'Downloads are not a reproduced leaderboard result.'}
    (ROOT/'outputs/local-model-download.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Download complete; runtime still requires a GPU smoke test.',flush=True)


if __name__=='__main__': main()
