import base64
import io
import json
from pathlib import Path
import wave

import pytest
from lifemate.hosted_runner import Hosted, RELEASE


def test_hosted_requires_https_and_secret():
    with pytest.raises(ValueError): Hosted('http://remote.invalid', 'x'*32)
    with pytest.raises(ValueError): Hosted('https://remote.invalid', 'short')


def test_hosted_preserves_release_request_and_normalizes_asr():
    calls=[]; h=Hosted('https://unit.invalid','x'*32)
    h.request=lambda path,body=None,timeout=120: calls.append((path,body,timeout)) or {'text':'XIN CHÀO','release_revision':RELEASE}
    h.complete([{'role':'system','content':'one'},{'role':'system','content':'two'},{'role':'user','content':'go'}],[],timeout=20)
    assert calls[0][1]['messages'][0]['content']=='one\n\ntwo'
    assert calls[0][1]['model']=='lifemate' and calls[0][1]['max_tokens']==512
    assert calls[0][1]['chat_template_kwargs']=={'enable_thinking':False}


def test_raw_asr_is_preserved_separately_from_normalized_transcript(tmp_path):
    audio=tmp_path/'audio.wav';audio.write_bytes(b'controlled input')
    h=Hosted('https://unit.invalid','x'*32)
    h.request=lambda *a,**k:{'text':'  XIN CHÀO  ','release_revision':RELEASE}
    assert h.transcribe_result(audio)=={'raw_text':'  XIN CHÀO  ','normalized_text':'xin chào'}


def test_notebook_cells_compile_and_weights_are_colab_only():
    p=Path(__file__).resolve().parents[1]/'notebooks/lifemate_datyth_vllm_colab.ipynb'
    nb=json.loads(p.read_text(encoding='utf-8'))
    for c in nb['cells']:
        if c['cell_type']=='code':
            assert c['execution_count'] is None and c['outputs']==[]
            compile(''.join(c['source']),c['id'],'exec')
    assert 'google.colab' in ''.join(nb['cells'][1]['source'])


def test_gateway_auth_chat_forward_and_real_wav_layout(monkeypatch):
    pytest.importorskip('fastapi')
    from fastapi.testclient import TestClient
    from scripts import colab_gateway as g
    class ASR:
        def transcribe(self,path): assert path.is_file(); return 'fixture only'
    class Response:
        status_code=200
        def json(self):return {'choices':[{'message':{'role':'assistant','content':'done'}}]}
    seen=[]
    monkeypatch.setattr(g.requests,'post',lambda url,**kw: seen.append((url,kw)) or Response())
    with TestClient(g.create_app(ASR(),'x'*32)) as client:
        assert client.post('/v1/chat/completions',json={'model':'lifemate'}).status_code==401
        auth={'Authorization':'Bearer '+'x'*32}
        r=client.post('/v1/chat/completions',headers=auth,json={'model':'lifemate','messages':[]})
        assert r.status_code==200 and seen[0][0]=='http://127.0.0.1:8001/v1/chat/completions'
        assert seen[0][1]['json']['chat_template_kwargs']=={'enable_thinking':False}
        assert client.post('/v1/audio/transcriptions',headers=auth,json={'audio_base64':'invalid'}).status_code==400
        b=io.BytesIO()
        with wave.open(b,'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b'\0\0'*1600)
        r=client.post('/v1/audio/transcriptions',headers=auth,json={'audio_base64':base64.b64encode(b.getvalue()).decode()})
        assert r.json()=={'text':'fixture only','release_revision':RELEASE}
