"""Dashboard artifact adapter for the remediated native E1P agent. No local models."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid

from .hosted_runner import Hosted, RELEASE
from .agent import execute
from .data import DATA_ROOT, PROJECT, VALIDATION_IDS, items, catalog, installed_tools, audio_path
from .metrics import exact_tool_f1
from .scoring import fuzzy_keys, score_sample
from .toolenv import new_env
from .submission import validate_file
from .artifacts import atomic_json as atomic
from .history import runtime_status

MODEL = 'Qwen3.5-4B BF16 + p1 / Gipformer'
EVALUATOR = 'datyth-strict-f1-hash-v2-formula'
HARNESS = 'e1p-remediation-v1'

def now():
    return datetime.now(timezone.utc).isoformat()

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

class Paused(Exception):
    pass

def run(directory):
    job = read(directory / 'job.json'); config = job['config']
    split = 'train' if config['kind'] == 'train-test' else 'public_test'
    modes = ['gold-text', 'full-asr'] if config['mode'] == 'paired' else [config['mode']]
    samples = list(items(DATA_ROOT, split)); full_count = len(samples)
    if split == 'train' and config.get('subset') == 'validation':
        ids = set(read(VALIDATION_IDS)); samples = [s for s in samples if s['id'] in ids]
    if config['limit']: samples = samples[:config['limit']]
    if not samples: raise ValueError('Empty selection')
    specs = catalog(DATA_ROOT, split)
    fuzzy = fuzzy_keys(specs)
    # Resume cannot silently mix code, inputs, config or release identities.
    fingerprint = hashlib.sha256(json.dumps([config, samples, specs, RELEASE], sort_keys=True).encode())
    for path in sorted((PROJECT / 'src/lifemate').glob('*.py')): fingerprint.update(path.read_bytes())
    signature = fingerprint.hexdigest()
    checkpoint = directory / 'manifest.json'
    if checkpoint.exists() and read(checkpoint)['signature'] != signature:
        raise ValueError('Code/data/config changed; create a new run instead of resuming')
    hosted = Hosted(os.environ['LIFEMATE_MODEL_API_URL'], os.environ['LIFEMATE_MODEL_API_KEY'])
    identity = hosted.request('/v1/models')
    if identity.get('release_revision') != RELEASE or not any(m['id'] == 'lifemate' for m in identity.get('data', [])):
        raise ValueError('Wrong Colab release')
    atomic(checkpoint, {'signature': signature, 'runtime': identity, 'ids': [s['id'] for s in samples],
                        'harness_revision':HARNESS,
                        'note': 'p1 trained on all TRAIN; diagnostic only, not held-out or official score.'})
    job.update(state='running', pid=os.getpid(), total=len(samples)*len(modes), processed=0, harness_revision=HARNESS,
               identity={k:identity.get(k) for k in ('release_revision','runtime','profile','asr','context_limit')})
    atomic(directory/'job.json', job)
    def cancelled():
        if (directory/'stop.request').exists(): raise Paused()
    original_complete = hosted.complete
    def complete(*args, **kwargs):
        cancelled()
        kwargs['timeout'] = min(kwargs.get('timeout') or 120, config['request_seconds'])
        result = original_complete(*args, **kwargs); cancelled(); return result
    hosted.complete = complete
    all_modes = {}
    live = None; branch = directory
    try:
        for mode in modes:
            branch = directory/mode if len(modes)>1 else directory
            branch.mkdir(parents=True, exist_ok=True)
            saved = read(branch/'checkpoint.json') if (branch/'checkpoint.json').exists() else []
            if [r['prediction']['id'] for r in saved] != [s['id'] for s in samples[:len(saved)]]:
                raise ValueError('Checkpoint order mismatch')
            metadata = dict(name=job['name'], model=MODEL, split=split, mode=mode, run_id=job['id']+':'+mode,
                        started_at=job['created_at'], expected_total=len(samples), evaluator_revision=EVALUATOR,
                            harness_revision=HARNESS)
            def publish():
                # Checkpoint is authoritative. UI projections may be rebuilt after a crash.
                atomic(branch/'checkpoint.json', saved)
                atomic(branch/'evaluations.json', {'metadata': metadata, 'samples': [r['evaluation'] for r in saved]})
                job['processed'] = sum(len(v) for v in all_modes.values())+len(saved)
                atomic(directory/'job.json', job)
            publish()
            # Rebuild only committed traces on resume; discard the partial sample's trace.
            (branch/'trace.jsonl').write_text(''.join(json.dumps(e, ensure_ascii=False)+'\n' for r in saved for e in r['events']), encoding='utf-8')
            atomic(branch/'live-inputs.json', samples)
            live = dict(run_id=job['id'], name=job['name'], model=MODEL, split=split, mode=mode, total=len(samples),
                        kind='evaluation' if split=='train' else 'inference', state='running', pid=os.getpid(),
                        started_at=job['created_at'], updated_at=now(), generation=uuid.uuid4().hex,
                        audio_root=str(DATA_ROOT/split), evaluator_revision=EVALUATOR)
            atomic(branch/'live.json', live)
            atomic(PROJECT/'.lifemate-live/latest.json', {'directory':str(branch), 'run_id':job['id']})
            for item in samples[len(saved):]:
                cancelled(); start=time.monotonic(); events=[]; steps=[]; planning=[]; cache={}; termination={}
                timing={'speech':0.0,'planning':0.0,'tools':0.0};raw_transcripts={}
                env=new_env(DATA_ROOT, split, item['id']); transcript=None; status='completed'
                def emit(event_type, **data):
                    event=dict(event_type=event_type, sample_id=item['id'], timestamp=now(), **data); events.append(event)
                    with (branch/'trace.jsonl').open('a', encoding='utf-8') as f: f.write(json.dumps(event, ensure_ascii=False)+'\n')
                def log(kind, record):
                    cancelled()
                    if kind=='terminations':
                        termination.update(record)
                        emit('agent_termination',status=record['status'],operationIssues=record.get('operation_issues',[]),blockCounts=record.get('block_counts',{}))
                    if kind=='model_request':
                        if record['stage']=='started':emit('planning_started',step=record['turn'])
                        else:
                            timing['planning']+=record.get('latency_seconds',0)
                            emit('model_request_finished',step=record['turn'],status=record['stage'],elapsed_seconds=record.get('latency_seconds'),error_kind=record.get('error_kind'),error=record.get('error'))
                    if kind=='protocol_events':emit('protocol_error',step=record['turn'],error=record.get('kind'),result=record)
                    if kind=='llm_turns':
                        entry=dict(step=record['turn'], action='native_tools', rawResponse=json.dumps(record.get('output'),ensure_ascii=False),
                                   toolName=None, arguments={}, usage=record.get('usage') or {},finishReason=record.get('finish_reason'))
                        planning.append(entry)
                        emit('model_response', planning_entry=entry)
                    if kind=='tool_events':
                        name=record.get('name', record.get('proposed',{}).get('function',{}).get('name','unknown'))
                        args=record.get('arguments')
                        if args is None:
                            raw=record.get('proposed',{}).get('function',{}).get('arguments',{})
                            try: args=json.loads(raw) if isinstance(raw,str) else raw
                            except (ValueError,TypeError): args={'_invalid_json':raw}
                            if not isinstance(args,dict): args={'_invalid_arguments':args}
                        validation=record.get('validation',{})
                        step=dict(name=name, arguments=args, step=record['turn'])
                        if record.get('executed'):
                            timing['tools']+=record.get('latency_seconds',0)
                            step['observation']=record.get('result')
                            step['outcome']=record.get('outcome')
                            emit('tool_executed',tool_name=name,arguments=args,result=record.get('result'),step=record['turn'],outcome=record.get('outcome'),elapsed_seconds=record.get('latency_seconds'))
                        else:
                            error=validation.get('error',record.get('error','Rejected'))
                            guard=record.get('block_reason') in ('precondition','duplicate','retry_budget_exhausted','search_constraint_change')
                            step['guardError' if guard else 'validationError']=error
                            step['blockReason']=record.get('block_reason')
                            if guard:emit('candidate_blocked',source='harness_guard',tool_name=name,arguments=args,error=error,step=record['turn'],block_reason=record.get('block_reason'))
                            else:emit('agent_step',tool_name=name,arguments=args,validation_ok=False,validation_error=error,step=record['turn'],block_reason=record.get('block_reason'))
                        steps.append(step)
                def transcribe(relative):
                    cancelled()
                    if relative not in cache:
                        tick=time.monotonic()
                        remaining=config['sample_seconds']-(time.monotonic()-start)
                        if remaining<=0: raise TimeoutError('Sample deadline')
                        if mode=='gold-text':
                            cache[relative]=next(t['audio_text'] for t in [item,*item.get('history',[])] if t.get('audio')==relative)
                        else:
                            path=audio_path(DATA_ROOT,split,relative)
                            if hasattr(hosted,'transcribe_result'):
                                decoded=hosted.transcribe_result(path,min(remaining,config['request_seconds']))
                                raw_transcripts[relative]=decoded['raw_text']; cache[relative]=decoded['normalized_text']
                            else:cache[relative]=hosted.transcribe(path,min(remaining,config['request_seconds']))
                        timing['speech']+=time.monotonic()-tick
                    cancelled(); return cache[relative]
                emit('sample_started'); emit('asr_started')
                try:
                    transcript=transcribe(item['audio'])
                    emit('transcription',stage='latest',raw_text=raw_transcripts.get(item['audio']),normalized_text=transcript)
                    view=deepcopy({k:item[k] for k in ('id','audio','context','history')})
                    for turn in view['history']:
                        if turn.get('role')=='user': turn.pop('audio_text',None)
                    execute(view,transcript,installed_tools(item,specs),env,hosted,transcribe,log,
                            max_turns=config['max_steps'],deadline_seconds=max(.001,config['sample_seconds']-(time.monotonic()-start)),
                            orchestration='E1P',dedup_calls=True,retry_cap=2)
                    status=runtime_status(termination.get('status'))
                except Paused: raise
                except Exception as exc:
                    status='execution_error'
                    termination.setdefault('status',type(exc).__name__)
                    emit('sample_error',error_kind=type(exc).__name__,error=str(exc),http_status=getattr(exc,'status_code',None))
                inference_seconds=time.monotonic()-start
                prediction=dict(id=item['id'],tool_calls=env.get_tool_calls(),state_hash=env.get_state_hash())
                gold_calls=item['label']['tool_calls'] if split=='train' else None
                gold_hash=None
                evaluator_start=time.monotonic()
                if gold_calls is not None:
                    gold=new_env(DATA_ROOT,split,item['id'])
                    for c in gold_calls: gold.call(c['name'],c['arguments'])
                    gold_hash=gold.get_state_hash()
                row=dict(id=item['id'],predictedCalls=prediction['tool_calls'],expectedCalls=gold_calls,
                         predictedHash=prediction['state_hash'],expectedHash=gold_hash,referenceText=item.get('audio_text'),
                         asrText=transcript if mode=='full-asr' else None,intent=transcript or '',audioFile=item['audio'],
                         context=item['context'],history=item.get('history',[]),steps=steps,planningTrace=planning,
                         status=status,stopReason=termination.get('status'),latencyMs=inference_seconds*1000,
                         timings={k:v*1000 for k,v in timing.items()},rawAsrText=raw_transcripts.get(item['audio']),
                         operationIssues=termination.get('operation_issues',[]),blockCounts=termination.get('block_counts',{}),
                         evaluatorMs=(time.monotonic()-evaluator_start)*1000,
                         usage={k:sum(p.get('usage',{}).get(k,0) or 0 for p in planning) for k in ('prompt_tokens','completion_tokens','total_tokens')},
                         engine='datyth',modelRequests=len(planning),predictedOos=termination.get('status')=='unsupported' if status=='completed' else None,
                         isOos=item.get('is_oos'))
                if gold_calls is not None:
                    formula=score_sample(prediction['tool_calls'],prediction['state_hash'],gold_calls,gold_hash,fuzzy)
                    row.update(sequenceMatch=prediction['tool_calls']==gold_calls,hashMatch=prediction['state_hash']==gold_hash,
                               toolF1=exact_tool_f1(prediction['tool_calls'],gold_calls),localScore=formula['score'])
                # localScore: organizer formula reimplemented in lifemate.scoring (TRAIN diagnostic, not a ZAIC score).
                emit('sample_finished',tool_calls=prediction['tool_calls'],state_hash=prediction['state_hash'],transcript=transcript,
                     status=status,stop_reason=row['stopReason'],elapsed_seconds=row['latencyMs']/1000,planningTrace=planning,
                     stage_seconds=timing,operationIssues=row['operationIssues'],blockCounts=row['blockCounts'],usage=row['usage'],engine='datyth')
                if gold_calls is not None:
                    emit('sample_evaluated',f1=row['toolF1'],local_formula_score=row['localScore'],state_hash_match=row['hashMatch'],sequence_exact_match=row['sequenceMatch'],gold_hash=gold_hash,pred_hash=prediction['state_hash'],gold_calls=gold_calls)
                saved.append(dict(prediction=prediction,evaluation=row,events=events)); publish()
            all_modes[mode]=saved
            live.update(state='completed',updated_at=now()); atomic(branch/'live.json',live)
        rows=all_modes[modes[-1]]
        predictions=directory/'submission.partial.jsonl'
        predictions.write_text(''.join(json.dumps(r['prediction'],ensure_ascii=False)+'\n' for r in rows),encoding='utf-8')
        try:
            validation=validate_file(DATA_ROOT,split,predictions,allow_partial=len(samples)!=full_count)
            validation.update(valid=True,errors=[])
        except Exception as exc: validation=dict(valid=False,errors=[str(exc)])
        # Agent outcomes (unresolved_tool_error, search_unresolved, step_limit, timeout...) still yield a valid scored line built
        # from the ToolEnv, exactly as docker_predict writes it; only transport/runtime failures (no agent outcome, or the model
        # endpoint failing) make the line unrepresentative of the pipeline and block the download.
        records=[r['evaluation'] for records in all_modes.values() for r in records]
        agent_ends={'step_limit','timeout'}
        blocking=[r['id'] for r in records if r['status']=='execution_error' and r.get('stopReason') not in agent_ends]
        validation.update(incomplete_samples=[r['id'] for r in records if r['status']!='completed' and r['id'] not in blocking],
                          blocking_errors=blocking)
        success=not blocking
        validation['ready_to_submit']=split=='public_test' and len(samples)==full_count and success and validation['valid']
        if validation['ready_to_submit']:
            payload=predictions.read_bytes(); (directory/'submission.jsonl').write_bytes(payload)
            validation['sha256']=hashlib.sha256(payload).hexdigest()
        atomic(directory/'validation.json',validation)
        job.update(state='completed' if success and validation['valid'] else 'failed',message='TRAIN diagnostic only; no official local score.')
    except Paused:
        job.update(state='paused',message='Paused; resume restarts only the uncommitted sample.')
    finally:
        if live:
            live.update(state=job['state'] if job['state'] in ('completed','paused','failed') else 'failed',updated_at=now())
            atomic(branch/'live.json',live)
        atomic(directory/'job.json',job)

if __name__=='__main__':
    directory=Path(sys.argv[1]).resolve()
    try: run(directory)
    except Exception as exc:
        job=read(directory/'job.json'); job.update(state='failed',message=f'Runner failed: {type(exc).__name__}: {exc}')
        atomic(directory/'job.json',job)
        raise
