"""Run E1P with the local remediation policy/ToolEnv, models on authenticated Colab API.

This development runner does NOT load model weights or require local CUDA.
"""
import argparse
import base64
from copy import deepcopy
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse
import requests

from .agent import execute
from .context import normalize_asr
from .data import items, catalog, installed_tools, audio_path
from .llm import merge_system
from .metrics import exact_tool_f1
from .scoring import fuzzy_keys, score_sample
from .toolenv import new_env
from .submission import validate_file
from .history import runtime_status

RELEASE='02080970ccd59a2e1aeec4fd66a17640da2cddf1'


class RemoteHTTPError(RuntimeError):
    def __init__(self, status_code):
        self.status_code = status_code
        super().__init__(f'Colab HTTP {status_code}; inspect server logs')


class Hosted:
    def __init__(self,url,key):
        u=urlparse(url)
        if u.scheme!='https' or u.username or u.password or u.query or u.fragment or u.path not in ('','/'):
            raise ValueError('Use the HTTPS tunnel origin')
        if len(key)<32:raise ValueError('Missing Colab secret')
        self.url=url.rstrip('/');self.session=requests.Session();self.session.headers['Authorization']='Bearer '+key
    def request(self,path,body=None,timeout=120):
        try:
            r=self.session.request('GET' if body is None else 'POST',self.url+path,json=body,timeout=timeout,allow_redirects=False)
        except requests.Timeout as exc:
            raise TimeoutError('Colab request exceeded its deadline') from exc
        if r.status_code!=200:raise RemoteHTTPError(r.status_code)
        return r.json()
    def complete(self,messages,tools,timeout=None):
        return self.request('/v1/chat/completions',{'model':'lifemate','messages':merge_system(messages),
            'tools':tools,'tool_choice':'auto','temperature':0,'seed':42,'max_tokens':512,
            'chat_template_kwargs':{'enable_thinking':False}},timeout=min(timeout or 120,120))
    def transcribe(self,path,timeout=120):
        return self.transcribe_result(path,timeout)['normalized_text']
    def transcribe_result(self,path,timeout=120):
        result=self.request('/v1/audio/transcriptions',{'audio_base64':base64.b64encode(path.read_bytes()).decode()},timeout=timeout)
        if result.get('release_revision')!=RELEASE or not isinstance(result.get('text'),str):raise ValueError('ASR identity/output mismatch')
        return {'raw_text':result['text'],'normalized_text':normalize_asr(result['text'])}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--split',choices=['train','public_test'],default='train');p.add_argument('--limit',type=int,default=1)
    p.add_argument('--mode',choices=['gold-text','full-asr'],default='full-asr')
    p.add_argument('--data-root',type=Path,default=Path('data/train+public_test'));p.add_argument('--output',type=Path,required=True)
    p.add_argument('--seconds',type=float,default=180)
    a=p.parse_args()
    if a.split=='public_test' and a.mode!='full-asr':raise ValueError('Public test requires audio')
    if a.limit<0 or a.seconds<=0:raise ValueError('Invalid budget')
    if a.output.exists():raise FileExistsError('Use a new run directory')
    hosted=Hosted(os.environ['LIFEMATE_MODEL_API_URL'],os.environ['LIFEMATE_MODEL_API_KEY'])
    identity=hosted.request('/v1/models')
    if identity.get('release_revision')!=RELEASE or not any(m['id']=='lifemate' for m in identity['data']):raise ValueError('Wrong release/model')
    samples=list(items(a.data_root,a.split));total=len(samples)
    if a.limit:samples=samples[:a.limit]
    specs=catalog(a.data_root,a.split);fuzzy=fuzzy_keys(specs);a.output.mkdir(parents=True)
    (a.output/'manifest.json').write_text(json.dumps({'runtime':identity,'split':a.split,'mode':a.mode,'ids':[s['id'] for s in samples],
        'seconds':a.seconds,'orchestration':'E1P','dedup_calls':True,'retry_cap':2,'max_turns':10,
        'note':'Release p1 trained on all TRAIN; TRAIN is diagnostic, not held-out.'},indent=2))
    metrics=[];failures=[]
    with (a.output/'trace.jsonl').open('w',encoding='utf-8') as trace, (a.output/'predictions.jsonl').open('w',encoding='utf-8') as predictions:
        for i,item in enumerate(samples,1):
            start=time.monotonic();env=new_env(a.data_root,a.split,item['id']);cache={};termination={}
            def log(kind,record):
                if kind=='terminations':termination.update(record)
                trace.write(json.dumps({'sample_id':item['id'],'event':kind,**record},ensure_ascii=False)+'\n');trace.flush()
            def transcribe(relative):
                if relative not in cache:
                    remaining=a.seconds-(time.monotonic()-start)
                    if remaining<=0:raise TimeoutError('Sample deadline')
                    if a.mode=='gold-text':
                        turn=next(t for t in [item,*item.get('history',[])] if t.get('audio')==relative)
                        cache[relative]=turn['audio_text']
                    else:cache[relative]=hosted.transcribe(audio_path(a.data_root,a.split,relative),min(120,remaining))
                return cache[relative]
            status='completed'
            try:
                transcript=transcribe(item['audio'])
                view=deepcopy({k:item[k] for k in ('id','audio','context','history')})
                for turn in view['history']:
                    if turn.get('role')=='user':turn.pop('audio_text',None)
                result=execute(view,transcript,installed_tools(item,specs),env,hosted,transcribe,log,
                    max_turns=10,deadline_seconds=max(.001,a.seconds-(time.monotonic()-start)),orchestration='E1P',dedup_calls=True,retry_cap=2)
                status=runtime_status(termination.get('status'))
                if status!='completed':failures.append(item['id'])
            except Exception as e:
                status='error';failures.append(item['id']);log('error',{'type':type(e).__name__})
                result={'id':item['id'],'tool_calls':env.get_tool_calls(),'state_hash':env.get_state_hash()}
            predictions.write(json.dumps(result,ensure_ascii=False)+'\n');predictions.flush()
            row={'id':item['id'],'status':status,'termination':termination,'seconds':time.monotonic()-start}
            if a.split=='train':
                gold=new_env(a.data_root,a.split,item['id'])
                for c in item['label']['tool_calls']:gold.call(c['name'],c['arguments'])
                row.update(strict_tool_f1=exact_tool_f1(result['tool_calls'],item['label']['tool_calls']),hash_match=result['state_hash']==gold.get_state_hash(),
                           formula_score=score_sample(result['tool_calls'],result['state_hash'],item['label']['tool_calls'],gold.get_state_hash(),fuzzy)['score'])
            metrics.append(row);(a.output/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
            print(f'{i}/{len(samples)} {item["id"]}: {status}',flush=True)
    validation=validate_file(a.data_root,a.split,a.output/'predictions.jsonl',allow_partial=len(samples)!=total)
    validation.update(failed_samples=failures,ready_to_submit=a.split=='public_test' and len(samples)==total and not failures)
    (a.output/'validation.json').write_text(json.dumps(validation,indent=2))
    if validation['ready_to_submit']:(a.output/'submission.jsonl').write_bytes((a.output/'predictions.jsonl').read_bytes())
    print(json.dumps(validation))


if __name__=='__main__':main()
