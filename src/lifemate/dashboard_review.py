"""Revalidate saved output or recompute TRAIN diagnostics without model inference."""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path

from .dashboard_runner import atomic, read, now, EVALUATOR
from .data import DATA_ROOT, items
from .data import catalog
from .metrics import exact_tool_f1
from .scoring import fuzzy_keys, score_sample, summarize
from .submission import validate_file
from .toolenv import new_env


def review(directory, action):
    job = read(directory/'job.json')
    if job['state'] not in ('completed', 'failed'):
        raise ValueError('Wait for the run to finish before reviewing output')
    split = 'train' if job['config']['kind']=='train-test' else 'public_test'
    if action=='local-score' and split!='train':
        raise ValueError('Public test has no ground truth; obtain the official score on ZAIC')
    references = {s['id']: s for s in items(DATA_ROOT, split)}
    modes = ['gold-text','full-asr'] if job['config']['mode']=='paired' else [job['config']['mode']]
    report = dict(action=action, created_at=now(), official_score=False, branches={})
    for mode in modes:
        branch = directory/mode if len(modes)>1 else directory
        checkpoint = read(branch/'checkpoint.json')
        rows = [r['prediction'] for r in checkpoint]
        if not rows: raise ValueError('No completed samples to review')
        # Prefer the actual downloadable file: detect modification after the run.
        source = directory/'submission.jsonl' if len(modes)==1 else branch/'submission.jsonl'
        if source.exists():
            payload=source.read_bytes()
            rows=[json.loads(line) for line in payload.decode('utf-8').splitlines() if line.strip()]
        else:
            payload=(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows)).encode('utf-8')
        digest=hashlib.sha256(payload).hexdigest()
        if action=='validate':
            with tempfile.TemporaryDirectory(prefix='lifemate-validate-') as tmp:
                file=Path(tmp)/'predictions.jsonl'; file.write_bytes(payload)
                try:
                    result=validate_file(DATA_ROOT,split,file,allow_partial=split=='train')
                    result.update(valid=True,errors=[])
                except Exception as exc:
                    result=dict(valid=False,errors=[str(exc)])
            result.update(samples=len(rows),full_split=len(rows)==len(references),sha256=digest)
            # Manual validation never promotes an incomplete run to ready-to-submit.
            original=directory/'validation.json'
            if original.exists():
                gate=read(original)
                if not result['valid'] or gate.get('sha256',digest)!=digest:
                    gate['ready_to_submit']=False; atomic(original,gate)
        else:
            if len({r['id'] for r in rows})!=len(rows): raise ValueError('Duplicate sample IDs')
            metrics=[]; formula={}; fuzzy=fuzzy_keys(catalog(DATA_ROOT,split))
            for row in rows:
                gold=references[row['id']]['label']['tool_calls']
                actual=new_env(DATA_ROOT,split,row['id'])
                # A schema-rejected call is logged and scored as unmatched (U) by the organizers; replay it as is.
                for call in row['tool_calls']: actual.call(call['name'],call['arguments'])
                if actual.get_state_hash()!=row['state_hash']: raise ValueError(f"Replay hash mismatch: {row['id']}")
                env=new_env(DATA_ROOT,split,row['id'])
                for call in gold: env.call(call['name'],call['arguments'])
                formula[row['id']]=score_sample(row['tool_calls'],row['state_hash'],gold,env.get_state_hash(),fuzzy)
                metrics.append(dict(id=row['id'],toolF1=exact_tool_f1(row['tool_calls'],gold),localScore=formula[row['id']]['score'],
                                    sequenceMatch=row['tool_calls']==gold,hashMatch=row['state_hash']==env.get_state_hash()))
            n=len(metrics)
            result=dict(samples=n,strict_tool_f1_percent=sum(r['toolF1'] for r in metrics)/n*100,
                        sequence_em_percent=sum(r['sequenceMatch'] for r in metrics)/n*100,
                        hash_match_percent=sum(r['hashMatch'] for r in metrics)/n*100,
                        formula=summarize(formula),evaluator=EVALUATOR,sha256=digest,
                        note='TRAIN diagnostic only: p1 trained on all TRAIN. formula.score reimplements the organizer formula '
                             '(lifemate.scoring); it is not a ZAIC score.')
            artifact=read(branch/'evaluations.json'); by_id={r['id']:r for r in metrics}
            for sample in artifact['samples']:
                if sample['id'] in by_id: sample.update(by_id[sample['id']])
            atomic(branch/'evaluations.json',artifact)
        report['branches'][mode]=result
    atomic(directory/('manual-validation.json' if action=='validate' else 'local-score.json'),report)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('directory',type=Path);p.add_argument('action',choices=['validate','local-score'])
    a=p.parse_args(); print(json.dumps(review(a.directory,a.action),ensure_ascii=False))
