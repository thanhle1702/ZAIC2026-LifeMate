"""Private gateway: vLLM chat on loopback + released Gipformer on Colab CPU."""
import base64
import hmac
import io
import os
from pathlib import Path
import tempfile
import threading
import wave

from fastapi import FastAPI, HTTPException, Request
import requests

RELEASE = '02080970ccd59a2e1aeec4fd66a17640da2cddf1'
# Served adapters a client may ask for: p1 alone, or the three members of the step-level vote (lifemate.ensemble).
MODELS = {'lifemate', 'lifemate_e1', 'lifemate_synth'}
CHAT_SLOTS = 3   # one in-flight request per vote member; vLLM batches them (--max-num-seqs >= 3)


def create_app(asr, key, context_limit=16384):
    if len(key) < 32: raise ValueError('Secret must have at least 32 characters')
    app = FastAPI(); lock = threading.Lock(); chat_slots = threading.BoundedSemaphore(CHAT_SLOTS)

    @app.middleware('http')
    async def auth(request: Request, call_next):
        from starlette.responses import JSONResponse
        if not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer '+key):
            return JSONResponse({'detail':'Unauthorized'}, status_code=401)
        if int(request.headers.get('content-length', '0')) > 12*1024**2:
            return JSONResponse({'detail':'Body too large'}, status_code=413)
        return await call_next(request)

    @app.get('/v1/models')
    def models():
        response=requests.get('http://127.0.0.1:8001/v1/models',timeout=5); response.raise_for_status()
        return {'data':response.json()['data'], 'release_revision':RELEASE,
            'asr':'released-gipformer', 'context_limit':context_limit, 'runtime':'vllm-0.32.0',
            'profile':'upstream-p1-bf16', 'trained_on_all_train':True}

    @app.post('/v1/chat/completions')
    def chat(body: dict):
        if body.get('model') not in MODELS or body.get('stream', False): raise HTTPException(400,'Use a served LifeMate adapter, non-streaming')
        body={k:v for k,v in body.items() if k in {'model','messages','tools','tool_choice','temperature','seed','max_tokens','chat_template_kwargs'}}
        body.update(temperature=0,seed=42,max_tokens=512,chat_template_kwargs={'enable_thinking':False})
        if not chat_slots.acquire(blocking=False): raise HTTPException(429,'Model busy')
        try:
            r=requests.post('http://127.0.0.1:8001/v1/chat/completions',json=body,timeout=120)
            if r.status_code!=200: raise HTTPException(r.status_code,'vLLM rejected request; inspect Colab logs')
            return r.json()
        finally: chat_slots.release()

    @app.post('/v1/audio/transcriptions')
    def transcribe(body: dict):
        try:
            encoded=body['audio_base64']
            if not isinstance(encoded,str) or len(encoded)>11_000_000: raise ValueError()
            data=base64.b64decode(encoded,validate=True)
            with wave.open(io.BytesIO(data),'rb') as w:
                if w.getframerate()!=16000 or not 0<w.getnframes()/16000<=30: raise ValueError()
        except (KeyError,ValueError,wave.Error,EOFError): raise HTTPException(400,'Require PCM WAV, 16kHz, <=30 seconds')
        if not lock.acquire(blocking=False): raise HTTPException(429,'Model busy')
        try:
            with tempfile.TemporaryDirectory() as d:
                path=Path(d)/'audio.wav';path.write_bytes(data)
                return {'text':asr.transcribe(path),'release_revision':RELEASE}
        finally: lock.release()
    return app


if __name__=='__main__':
    from lifemate.asr import GipformerASR
    import uvicorn
    asr=GipformerASR(Path('outputs/release/lifemate-final/asr-gipformer'),device='cpu')
    uvicorn.run(create_app(asr,os.environ['LIFEMATE_MODEL_API_KEY']),host='127.0.0.1',port=8000,access_log=False)
