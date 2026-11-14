import json
from copy import deepcopy
import pytest
from lifemate import dashboard_runner as d


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(d, 'PROJECT', tmp_path)
    monkeypatch.setenv('LIFEMATE_MODEL_API_URL', 'https://test.invalid')
    monkeypatch.setenv('LIFEMATE_MODEL_API_KEY', 'x'*32)
    sample=dict(id='a', audio='audio/a.wav', audio_text='hello', context={}, history=[], label={'tool_calls':[]})
    monkeypatch.setattr(d, 'items', lambda *a: iter([deepcopy(sample)]))
    monkeypatch.setattr(d, 'catalog', lambda *a: {})
    monkeypatch.setattr(d, 'installed_tools', lambda *a: [])
    class Host:
        def __init__(self,*a): pass
        def request(self,*a): return {'release_revision': d.RELEASE, 'data':[{'id':'lifemate'}]}
        def complete(self,*a,**k): return {}
    monkeypatch.setattr(d,'Hosted',Host)
    class Env:
        def get_tool_calls(self): return []
        def get_state_hash(self): return 'a'*64
    monkeypatch.setattr(d,'new_env',lambda *a: Env())
    monkeypatch.setattr(d,'validate_file',lambda *a,**k: {'rows':1})
    folder=tmp_path/'results/train-test'/('a'*32)
    config=dict(kind='train-test',mode='gold-text',limit=1,sample_seconds=180,request_seconds=90,max_steps=10,engine='datyth',subset='all')
    d.atomic(folder/'job.json', dict(id='a'*32,name='test',created_at=d.now(),config=config,state='queued'))
    return folder


def test_real_artifact_contract_formula_score(setup, monkeypatch):
    seen=[]
    def execute(view, transcript, tools, env, hosted, transcribe, log, **kwargs):
        assert 'label' not in view and 'audio_text' not in view
        seen.append(transcript)
        log('terminations',{'status':'no_action'})
    monkeypatch.setattr(d,'execute',execute)
    d.run(setup)
    assert seen==['hello']
    artifact=d.read(setup/'evaluations.json')['samples'][0]
    assert artifact['hashMatch'] is True and artifact['toolF1']==1
    assert 'taskSuccess' not in artifact and artifact['localScore']==1   # empty gold, empty prediction
    assert d.read(setup/'job.json')['state']=='completed'
    assert not (setup/'submission.jsonl').exists()


def test_pause_resume_restarts_uncommitted_sample(setup, monkeypatch):
    calls=[]
    def execute(*args, **kwargs):
        calls.append(1)
        if len(calls)==1: raise d.Paused()
    monkeypatch.setattr(d,'execute',execute)
    d.run(setup)
    assert d.read(setup/'job.json')['state']=='paused'
    assert d.read(setup/'checkpoint.json')==[]
    d.run(setup)
    assert len(calls)==2 and d.read(setup/'job.json')['processed']==1
    events=[json.loads(line) for line in (setup/'trace.jsonl').read_text().splitlines()]
    assert sum(e['event_type']=='sample_started' for e in events)==1


def test_resume_rejects_changed_config(setup, monkeypatch):
    monkeypatch.setattr(d,'execute',lambda *a,**k: a[6]('terminations',{'status':'no_action'}))
    d.run(setup)
    job=d.read(setup/'job.json');job['config']['max_steps']=11;d.atomic(setup/'job.json',job)
    with pytest.raises(ValueError,match='changed'): d.run(setup)


@pytest.mark.parametrize('valid', [True, False])
def test_public_download_requires_independent_validation(setup, monkeypatch, valid):
    job=d.read(setup/'job.json'); job['config'].update(kind='public-test',mode='full-asr',limit=0)
    d.atomic(setup/'job.json',job)
    monkeypatch.setattr(d.Hosted,'transcribe',lambda *a: 'hello',raising=False)
    monkeypatch.setattr(d,'audio_path',lambda *a: None)
    monkeypatch.setattr(d,'execute',lambda *a,**k: a[6]('terminations',{'status':'no_action'}))
    if not valid:
        def reject(*a,**k): raise ValueError('Replay mismatch')
        monkeypatch.setattr(d,'validate_file',reject)
    d.run(setup)
    assert d.read(setup/'validation.json')['ready_to_submit'] is valid
    assert (setup/'submission.jsonl').exists() is valid


def test_manual_validation_checks_actual_download_and_revokes_gate(setup, monkeypatch):
    from lifemate import dashboard_review as review
    monkeypatch.setattr(d,'execute',lambda *a,**k: a[6]('terminations',{'status':'no_action'}))
    d.run(setup)
    monkeypatch.setattr(review,'items',d.items)
    captured=[]
    def reject(root, split, file, **kwargs):
        captured.append(file.read_text())
        raise ValueError('Replay mismatch')
    monkeypatch.setattr(review,'validate_file',reject)
    (setup/'submission.jsonl').write_text('tampered')
    # Malformed JSON is rejected before replay and cannot produce a valid report.
    with pytest.raises(ValueError): review.review(setup,'validate')
    (setup/'submission.jsonl').write_text('{"id":"a","tool_calls":[],"state_hash":"bad"}\n')
    d.atomic(setup/'validation.json',{'ready_to_submit':True})
    result=review.review(setup,'validate')
    assert 'bad' in captured[0]
    assert result['branches']['gold-text']['valid'] is False
    assert d.read(setup/'validation.json')['ready_to_submit'] is False


def test_manual_score_recomputes_ground_truth_not_cached_metrics(setup, monkeypatch):
    from lifemate import dashboard_review as review
    monkeypatch.setattr(d,'execute',lambda *a,**k: a[6]('terminations',{'status':'no_action'}))
    d.run(setup)
    monkeypatch.setattr(review,'items',d.items)
    monkeypatch.setattr(review,'new_env',d.new_env)
    artifact=d.read(setup/'evaluations.json');artifact['samples'][0]['toolF1']=0
    d.atomic(setup/'evaluations.json',artifact)
    report=review.review(setup,'local-score')
    assert report['official_score'] is False
    assert report['branches']['gold-text']['strict_tool_f1_percent']==100
    assert d.read(setup/'evaluations.json')['samples'][0]['toolF1']==1
    job=d.read(setup/'job.json');job['config']['kind']='public-test';d.atomic(setup/'job.json',job)
    with pytest.raises(ValueError,match='ground truth'): review.review(setup,'local-score')


def test_committed_checkpoint_survives_projection_failure_and_resume_skips_model(setup, monkeypatch):
    calls=[]
    def execute(*a,**k):calls.append(1);a[6]('terminations',{'status':'no_action'})
    monkeypatch.setattr(d,'execute',execute)
    original=d.atomic
    def fail_projection(path,value):
        if path.name=='evaluations.json' and value['samples']:raise PermissionError('projection locked')
        return original(path,value)
    monkeypatch.setattr(d,'atomic',fail_projection)
    with pytest.raises(PermissionError):d.run(setup)
    assert len(d.read(setup/'checkpoint.json'))==1
    monkeypatch.setattr(d,'atomic',original)
    d.run(setup)
    assert len(calls)==1 and len(d.read(setup/'evaluations.json')['samples'])==1
    assert d.read(setup/'job.json')['processed']==1


def test_inference_latency_is_frozen_before_gold_replay(setup, monkeypatch):
    clock=[100.0];monkeypatch.setattr(d.time,'monotonic',lambda:clock[0])
    original=d.new_env;count=[]
    def env(*a):
        count.append(1)
        if len(count)>1:clock[0]+=9
        return original(*a)
    def execute(*a,**k):clock[0]+=2;a[6]('terminations',{'status':'no_action'})
    monkeypatch.setattr(d,'new_env',env);monkeypatch.setattr(d,'execute',execute)
    d.run(setup)
    sample=d.read(setup/'evaluations.json')['samples'][0]
    assert sample['latencyMs']==2000 and sample['evaluatorMs']==9000


@pytest.mark.parametrize('termination,ready', [('unresolved_tool_error', True), ('search_unresolved', True), ('step_limit', True), ('model_error', False)])
def test_public_gate_blocks_only_transport_failures(setup, monkeypatch, termination, ready):
    job=d.read(setup/'job.json'); job['config'].update(kind='public-test',mode='full-asr',limit=0)
    d.atomic(setup/'job.json',job)
    monkeypatch.setattr(d.Hosted,'transcribe',lambda *a: 'hello',raising=False)
    monkeypatch.setattr(d,'audio_path',lambda *a: None)
    def execute(*a,**k):
        a[6]('terminations',{'status':termination})
        if termination in ('step_limit','model_error'): raise RuntimeError(termination)
    monkeypatch.setattr(d,'execute',execute)
    d.run(setup)
    validation=d.read(setup/'validation.json')
    assert validation['ready_to_submit'] is ready and (setup/'submission.jsonl').exists() is ready
    assert validation['blocking_errors']==([] if ready else ['a'])
    assert validation['incomplete_samples']==(['a'] if ready else [])
    assert d.read(setup/'job.json')['state']==('completed' if ready else 'failed')
