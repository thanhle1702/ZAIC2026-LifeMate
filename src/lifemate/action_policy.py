"""Small, observation-only policies. No hidden state, task ontology or model calls."""
from collections import Counter
import json
import math
import re
import unicodedata


def signature(name, args):
    return json.dumps([name, args], sort_keys=True, ensure_ascii=False)


def folded(text):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFD', text.casefold().replace('đ','d'))
                           if not unicodedata.combining(c)).split())


# IATA code and city spellings of the same place (catalog: origin/destination accept either).
PLACES = {
    'sgn': 'ho chi minh', 'tp hcm': 'ho chi minh', 'tphcm': 'ho chi minh', 'tp ho chi minh': 'ho chi minh',
    'thanh pho ho chi minh': 'ho chi minh', 'sai gon': 'ho chi minh', 'han': 'ha noi', 'dad': 'da nang',
    'cxr': 'nha trang', 'pqc': 'phu quoc', 'hui': 'hue', 'uih': 'quy nhon', 'vca': 'can tho', 'hph': 'hai phong',
    'vdh': 'dong hoi', 'dli': 'da lat', 'vii': 'vinh', 'bmv': 'buon ma thuot', 'thd': 'thanh hoa', 'vcs': 'con dao',
    'pxu': 'pleiku', 'tbb': 'tuy hoa', 'vdo': 'van don', 'vcl': 'chu lai',
}


def place(value):
    key = ' '.join(re.sub(r'[^\w]+', ' ', folded(str(value))).split())
    return PLACES.get(key, key)


def same_filter(key, a, b):
    if key in ('origin', 'destination') and a is not None and b is not None: return place(a) == place(b)
    return a == b


def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values(): yield from objects(child)
    elif isinstance(value, list):
        for child in value: yield from objects(child)


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class ActionPolicy:
    def __init__(self, request):
        self.request = request
        self.entities = {}
        self.wallet_balance = None
        self.generation = Counter()
        self.executed = Counter()
        self.read_results = {}
        self.observation_revision = Counter()
        self.failed_write_results = {}
        self.searches = {}
        self.issues = []

    def entity(self, app, identifier):
        return self.entities.get((app, identifier), {})

    def operation_key(self, name, args):
        target = dict(args)
        if name == 'banking.transfer':
            # Changing the funding account can recover the same transfer. Amount/payee must match.
            target.pop('from_account_id', None)
        return signature(name, target)

    def issue(self, name, args, reason, kind):
        key = self.operation_key(name, args)
        existing = next((r for r in self.issues if r['key'] == key and r['state'] == 'unresolved'), None)
        if existing:
            existing['attempts'] += 1
            return
        self.issues.append(dict(key=key, name=name, arguments=dict(args), reason=reason,
                                kind=kind, state='unresolved', attempts=1))

    def unresolved(self):
        return [r for r in self.issues if r['state'] == 'unresolved']

    def observe(self, name, args, result, kind, historical=False):
        if not isinstance(result, dict) or result.get('ok') is not True or result.get('done') is False:
            if kind == 'write' and not historical:
                self.failed_write_results[signature(name,args)] = (self.observation_revision[name.split('.',1)[0]], result)
                self.issue(name, args, (result or {}).get('message', 'operation not completed') if isinstance(result, dict) else 'invalid tool result', 'tool')
            return
        app = name.split('.', 1)[0]
        self.observation_revision[app] += 1
        key = self.operation_key(name, args)
        if kind == 'write' and not historical:
            for issue in self.issues:
                same_draft_tool = issue['kind'] == 'schema' and issue['name'] == name
                if (issue['key'] == key or same_draft_tool) and issue['state'] == 'unresolved': issue['state'] = 'recovered'
        if name == 'sys.ask_missing_info' and not historical:
            # Waiting for the user is a legitimate terminal outcome, not proof the goal is done.
            for issue in self.issues:
                if issue['name'] == args.get('tool_name') and issue['state'] == 'unresolved': issue['state'] = 'deferred_to_user'
        if kind == 'write':
            self.generation[app] += 1
            self.searches = {n:g for n,g in self.searches.items() if n.split('.',1)[0] != app}
            old = dict(self.entities)
            self.entities = {k:v for k,v in self.entities.items() if k[0] != app}
            # Preserve only quantities whose transition is explicit in the tool result (TRAIN apps only).
            if name == 'banking.transfer' and numeric(result.get('balance')):
                entity = dict(old.get((app,args.get('from_account_id')), {}))
                entity.update(id=args['from_account_id'], balance=result['balance'])
                self.entities[(app,args['from_account_id'])] = entity
            if name == 'loyalty.redeem' and numeric(result.get('points')):
                for k, entity in old.items():
                    if k[0] == app and folded(str(args.get('program',''))) in {folded(str(entity.get(x,''))) for x in ('id','name','merchant')}:
                        self.entities[k] = {**entity, 'points':result['points']}
            if app == 'ewallet': self.wallet_balance = result.get('balance') if numeric(result.get('balance')) else None
        for obj in objects(result):
            identifier = obj.get('id')
            if isinstance(identifier,str):
                self.entities[(app,identifier)] = {**self.entities.get((app,identifier),{}), **obj}
        if name == 'ewallet.get_balance' and numeric(result.get('balance')): self.wallet_balance=result['balance']

    def precondition_error(self, name, args):
        contract = {
            'banking.transfer': ('banking','from_account_id','amount','balance'),
        }.get(name)
        if contract:
            app, identifier, amount, capacity = contract
            available = self.entity(app,args.get(identifier)).get(capacity)
            if numeric(available) and numeric(args.get(amount)) and args[amount] > available:
                return f'{amount}={args[amount]} exceeds observed {capacity}={available}; do not execute this proposal. Reconsider the user condition or ask for missing information; do not silently change the amount.'
        if name in ('ewallet.transfer','ewallet.pay_qr','ewallet.topup_mobile'):
            if numeric(self.wallet_balance) and numeric(args.get('amount')) and args['amount'] > self.wallet_balance:
                return f'amount={args["amount"]} exceeds observed wallet balance={self.wallet_balance}; resolve the user condition before paying.'
        return None

    def repeat_allowed(self, name, args):
        if name != 'loyalty.redeem': return False
        # Split before folding: folded 'doi' would also catch dời/đôi/đội/đối/dõi.
        request = unicodedata.normalize('NFC', self.request).lower()
        clauses = [folded(c) for c in re.split(r'[;]|\b(?:rồi|và|sau đó)\b', request) if 'đổi' in re.findall(r'\w+', c)]
        if not clauses: return False
        if len(clauses) == 1: text = clauses[0]
        else:
            names = {folded(str(program.get(k,''))) for (app,_),program in self.entities.items()
                     if app=='loyalty' and args.get('program')==program.get('id') for k in ('name','merchant')}
            matches = [c for c in clauses if any(n and n in c for n in names)]
            if len(matches)!=1:return False
            text=matches[0]
        # Explicit bounded multiplicity or redeem-all backed by observed points/cost.
        count = re.search(r'\b([2-8]|hai|ba|bon|nam|sau|bay|tam)\s+(?:ve|ly|lan|phan|cai|voucher)\b',text)
        number = {'hai':2,'ba':3,'bon':4,'nam':5,'sau':6,'bay':7,'tam':8}
        limit = number.get(count[1], int(count[1]) if count and count[1].isdigit() else 1) if count else 1
        all_points = 'doi het' in text or bool(re.search(r'bao nhieu.*(?:het|bay nhieu)',text))
        if not count and not all_points: return False
        if self.executed[signature(name,args)] >= (8 if all_points else limit): return False
        for (app,_), program in self.entities.items():
            if app != 'loyalty' or folded(str(args.get('program',''))) not in {folded(str(program.get(x,''))) for x in ('id','name','merchant')}: continue
            reward = next((r for r in program.get('rewards',[]) if r.get('id')==args.get('reward_id')), {})
            if numeric(program.get('points')) and numeric(reward.get('cost')) and reward['cost'] > 0:
                return program['points'] >= reward['cost']
        return False

    def search_group(self, name, args):
        groups=self.searches.setdefault(name,[])
        selectors={k:folded(str(v)) for k,v in args.items() if k in ('query','symbol') or k.endswith('_id')}
        selector=' '.join(selectors.values())
        request=folded(self.request)
        for group in groups:
            previous=group['selector']
            if selector==previous or (selector and previous and (selector in previous or previous in selector)):
                return group
        # A clearly mentioned different entity gets its own budget; guessed spellings share the current budget.
        explicit=bool(selector and selector in request)
        if groups and not explicit: return groups[-1]
        group={'selector':selector,'empty':0,'filters':{k:v for k,v in args.items() if k in ('date','date_from','date_to','origin','destination')}}
        groups.append(group)
        return group

    def read_error(self, name, args, cap):
        group=self.search_group(name,args)
        if group['empty']:
            changed={k:v for k,v in group['filters'].items() if not same_filter(k,args.get(k),v)}
            flexible=bool(re.search(r'ngay (?:nao|khac)|bat ky|som nhat|muon nhat',folded(self.request)))
            if changed and not flexible:
                return 'search_constraint_change', f'Previous search was empty. Keep the user date/route filters {group["filters"]}; do not invent a different date or route. Use only schema-valid query fallback or ask_missing_info.'
        if cap and group['empty'] >= cap:
            return 'retry_budget_exhausted', f'This entity search đã trả về rỗng {group["empty"]} lần. Do not retry it. Handle other requested entities or ask_missing_info; do not guess an ID/date.'
        return None

    def record_read(self, name, args, result, empty):
        self.read_results[(signature(name,args),self.generation[name.split('.',1)[0]])]=result
        if empty:self.search_group(name,args)['empty']+=1

    def cached_read(self, name, args):
        return self.read_results.get((signature(name,args),self.generation[name.split('.',1)[0]]))

    def repeated_failed_write(self, name, args):
        failed = self.failed_write_results.get(signature(name,args))
        return failed is not None and failed[0] == self.observation_revision[name.split('.',1)[0]]
