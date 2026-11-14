"""Controlled model proposals and real TRAIN replay; no GPU/API inference."""
import json
from pathlib import Path
import pytest
from lifemate.agent import execute
from lifemate.action_policy import ActionPolicy
from lifemate.data import items, catalog, installed_tools
from lifemate.toolenv import new_env
from test_core import MemoryEnv, ResponsesLLM, response

ITEM={'id':'probe','context':{'current_time':'2026-11-11T09:00:00+07:00','installed_apps':{}},'history':[]}
READ={'name':'contacts.search','kind':'read','parameters':{'type':'object','properties':{'query':{'type':'string'}},'required':['query']}}
WRITE={'name':'tasks.add','kind':'write','parameters':{'type':'object','properties':{'title':{'type':'string'}},'required':['title']}}


def run(model,specs,env=None,text='probe',**kw):
    env=env or MemoryEnv();events=[]
    execute(ITEM,text,specs,env,model,lambda _: '',lambda k,r:events.append((k,r)),**kw)
    return env, [r for k,r in events if k=='terminations'][-1], events


def test_truncated_native_calls_are_not_partially_committed_then_repair_once():
    model=ResponsesLLM([response(call=('tasks__add',{'title':'one'}),reason='length'),response(call=('tasks__add',{'title':'one'})),response()])
    env,termination,events=run(model,[WRITE])
    assert len(env.calls)==1 and termination['status']=='completed_write'
    assert len([r for k,r in events if k=='protocol_events'])==1
    assert [r['stage'] for k,r in events if k=='model_request']==['started','finished']*3


def test_fake_tool_text_never_executes_and_only_one_repair_is_allowed():
    model=ResponsesLLM([response('<tool_call>tasks.add</tool_call>')]*2)
    env,termination,_=run(model,[WRITE])
    assert env.calls==[] and termination['status']=='invalid_protocol'
    assert len(model.messages)==2


def test_search_budget_is_per_entity_and_keeps_unresolved_target_visible():
    class SearchEnv(MemoryEnv):
        def call(self,name,args):
            super().call(name,args)
            return {'ok':True,'contacts':[{'id':'lan'}] if args['query']=='Lan' else []}
    model=ResponsesLLM([response(call=('contacts__search',{'query':q})) for q in ('anh Dũng','Dũng','D','Lan')]+[response()])
    env,termination,_=run(model,[READ],SearchEnv(),'gọi anh Dũng và Lan',retry_cap=2)
    assert [c['arguments']['query'] for c in env.calls]==['anh Dũng','Dũng','Lan']
    assert termination['status']=='search_unresolved'
    assert termination['block_counts']=={'retry_budget_exhausted':1}


def test_retry_cap_and_duplicate_loop_have_distinct_terminations():
    class Empty(MemoryEnv):
        def call(self,name,args):super().call(name,args);return {'ok':True,'contacts':[]}
    model=ResponsesLLM([response(call=('contacts__search',{'query':q})) for q in ('anh Dũng','Dũng','D','Du','Dun')])
    _,termination,_=run(model,[READ],Empty(),'gọi Dũng',retry_cap=2)
    assert termination['status']=='retry_budget_exhausted'
    model=ResponsesLLM([response(call=('contacts__search',{'query':'Dũng'}))]*4)
    _,termination,_=run(model,[READ],Empty(),'gọi Dũng',dedup_calls=True)
    assert termination['status']=='duplicate_loop'


def test_read_cache_is_invalidated_by_write_on_same_app():
    read={'name':'tasks.list','kind':'read','parameters':{}}
    model=ResponsesLLM([response(call=('tasks__list',{})),response(call=('tasks__add',{'title':'one'})),response(call=('tasks__list',{})),response()])
    env,termination,_=run(model,[read,WRITE],dedup_calls=True)
    assert [c['name'] for c in env.calls]==['tasks.list','tasks.add','tasks.list']
    assert termination['status']=='completed_write'


def test_repeated_additive_write_without_quantity_evidence_stays_blocked():
    model=ResponsesLLM([response(call=('tasks__add',{'title':'one'}))]*2+[response()])
    env,termination,_=run(model,[WRITE],text='tạo một việc',dedup_calls=True)
    assert len(env.calls)==1 and termination['status']=='unresolved_tool_error'


def test_failed_write_is_not_executed_again_without_new_information():
    class Failed(MemoryEnv):
        def call(self,name,args):super().call(name,args);return {'ok':True,'done':False,'message':'capacity'}
    model=ResponsesLLM([response(call=('tasks__add',{'title':'one'}))]*4)
    env,termination,_=run(model,[WRITE],Failed(),dedup_calls=True)
    assert len(env.calls)==1 and termination['status']=='duplicate_loop'


def test_no_guard_for_apps_outside_train():
    # Guards name TRAIN apps only; a public-only app is never blocked on observed quantities.
    p=ActionPolicy('use three')
    p.observe('pantry.list_items',{}, {'ok':True,'items':[{'id':'p1','stock':2}]},'read')
    assert p.precondition_error('pantry.consume',{'item_id':'p1','quantity':3}) is None


def test_bank_and_wallet_guards_update_after_successful_writes():
    p=ActionPolicy('pay and book')
    p.observe('banking.get_balance',{}, {'ok':True,'accounts':[{'id':'a1','balance':300}]},'read')
    p.observe('banking.transfer',{'from_account_id':'a1','beneficiary_id':'b1','amount':200},{'ok':True,'balance':100},'write')
    assert p.precondition_error('banking.transfer',{'from_account_id':'a1','amount':150})
    p.observe('ewallet.get_balance',{}, {'ok':True,'balance':50},'read')
    assert p.precondition_error('ewallet.pay_qr',{'merchant_id':'m1','amount':60})


def test_failed_transfer_can_recover_using_another_account_but_not_another_payee():
    p=ActionPolicy('transfer')
    args={'from_account_id':'a1','beneficiary_id':'b1','amount':100}
    p.observe('banking.transfer',args,{'ok':True,'done':False},'write')
    p.observe('banking.transfer',{**args,'beneficiary_id':'b2'},{'ok':True,'balance':0},'write')
    assert len(p.unresolved())==1
    p.observe('banking.transfer',{**args,'from_account_id':'a2'},{'ok':True,'balance':0},'write')
    assert not p.unresolved() and p.issues[0]['state']=='recovered'


def test_success_in_another_app_does_not_resolve_failed_write():
    p=ActionPolicy('do then shop')
    p.observe('tasks.complete',{'task_id':'t1'},{'ok':True,'done':False},'write')
    p.observe('shopping_list.add',{'name':'item','quantity':1},{'ok':True,'item':{'id':'s1'}},'write')
    assert len(p.unresolved())==1


def test_quantity_for_another_action_does_not_authorize_extra_redemptions():
    p=ActionPolicy('đổi một ly cà phê rồi đặt hai vé tàu')
    p.observe('loyalty.get_points',{}, {'ok':True,'programs':[{'id':'p','points':100,'rewards':[{'id':'r','cost':10}]}]},'read')
    assert not p.repeat_allowed('loyalty.redeem',{'program':'p','reward_id':'r'})


@pytest.mark.parametrize('sid',['train_0922','train_1447'])
def test_real_train_repeated_redemptions_replay_without_blocking_second_voucher(sid):
    root=Path(__file__).resolve().parents[1]/'data/train+public_test'
    if not (root/'train').is_dir():pytest.skip('TRAIN kit unavailable')
    item=next(s for s in items(root,'train') if s['id']==sid)
    model=ResponsesLLM([response(call=(c['name'].replace('.','__'),c['arguments'])) for c in item['label']['tool_calls']]+[response()])
    env=new_env(root,'train',sid);events=[]
    execute(item,item['audio_text'],installed_tools(item,catalog(root,'train')),env,model,
            lambda relative:next(t['audio_text'] for t in item.get('history',[]) if t.get('audio')==relative),
            lambda k,r:events.append((k,r)),dedup_calls=True,retry_cap=2,max_turns=12)
    assert env.get_tool_calls()==item['label']['tool_calls']
    assert not [r for k,r in events if k=='tool_events' and not r.get('executed')]
