"""Build the synthetic split outputs/synth/synth/ in the layout of the organizers' kit, so ToolEnv("synth", id, root) and the SFT
builder work on it unchanged.

    .venv/bin/python scripts/data/build_synth_split.py [--out outputs/synth] [--exclude-apps a,b] [--seed 7]

- zaic_tools/ is a copy of the TRAIN package plus synth/apps/synth_apps.py; the catalog is the TRAIN catalog plus synth/catalog.py.
- Each task (synth/tasks/*.py, TASKS) gives the app states it needs, the time, the utterance and the gold calls. The other installed
  apps (distractors, ~9 apps per sample as in TRAIN) and the user profile come from a random TRAIN sample outside the 200 validation
  IDs, read through ToolEnv.get_state() (allowed on TRAIN); no environment file is opened directly.
- History (TRAIN has prior turns in 66% of samples, synth v1 had none): a task may carry its own written history ("history":
  [{"role": "user", "text": ...}, {"role": "assistant", "text": ..., "tool_calls": [...], "tool_results": [...]}]); otherwise, with
  probability --history-rate, the prior turns of the TRAIN context sample are kept as distractor history, unless they touch an
  app of the task or end with the assistant asking something (the request would then answer that question, not the task).
- Gold calls are replayed with the official Session: every call must pass the schema check, writes must not be no-ops, and the
  results / final_state are stored as the label, like TRAIN."""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
KIT = PROJECT / "data/train+public_test"
sys.path.insert(0, str(PROJECT / "src"))
sys.path.insert(0, str(PROJECT))
sys.path.insert(0, str(PROJECT / "synth/tasks"))


def load(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def train_contexts(n_needed: int, exclude: set[str], seed: int) -> list[dict]:
    """(context, states) of random TRAIN samples outside validation, via a child process (one zaic_tools copy per process)."""
    code = r'''
import json, sys, random
sys.path.insert(0, sys.argv[1] + "/train")
from zaic_tools import ToolEnv
val = set(json.load(open(sys.argv[2])))
exclude = set(x for x in sys.argv[3].split(",") if x)
items = [json.loads(l) for l in open(sys.argv[1] + "/train/train.jsonl", encoding="utf-8")]
items = [x for x in items if x["id"] not in val]
rng = random.Random(int(sys.argv[4]))
out = []
for x in rng.sample(items, min(int(sys.argv[5]), len(items))):
    st = ToolEnv("train", x["id"], root=sys.argv[1]).get_state()
    apps = {a: v for a, v in x["context"]["installed_apps"].items() if a not in exclude}
    out.append({"from": x["id"], "context": {**x["context"], "installed_apps": apps}, "states": {a: st[a] for a in apps if a in st},
                "history": x.get("history") or []})
print(json.dumps(out, ensure_ascii=False))
'''
    res = subprocess.run([sys.executable, "-c", code, str(KIT), str(PROJECT / "configs/splits/validation_ids.json"), ",".join(sorted(exclude)),
                          str(seed), str(n_needed)], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def train_convention(gold: list[dict]) -> list[dict]:
    """TRAIN asks for a missing VALUE without first reading the app (68 of 75); synth v1 often searched first. Drop the
    same-app reads right before such an ask. Asks for an *_id keep their read (the read is what shows the ambiguity)."""
    if not gold or gold[-1]["name"] != "sys.ask_missing_info":
        return gold
    ask = gold[-1]["arguments"]
    if all(p.endswith("_id") for p in ask.get("params", [])):
        return gold
    app = str(ask.get("tool_name", "")).split(".")[0]
    head = list(gold[:-1])
    while head and head[-1]["name"].split(".")[0] == app and head[-1]["name"].split(".")[1].startswith(("search", "list", "get", "find")):
        head.pop()
    return head + [gold[-1]]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=PROJECT / "outputs/synth")
    ap.add_argument("--exclude-apps", default="", help="TRAIN apps never installed as distractors (held-out-app study)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--history-rate", type=float, default=0.0, help="share of tasks without their own history that keep the TRAIN context's turns")
    ap.add_argument("--apps", type=Path, default=PROJECT / "synth/apps/synth_apps.py", help="app module copied into zaic_tools/apps/")
    ap.add_argument("--catalog", type=Path, default=PROJECT / "synth/catalog.py", help="module whose APPS extend the TRAIN catalog")
    ap.add_argument("--tasks", type=Path, default=PROJECT / "synth/tasks", help="folder of task modules (TASKS)")
    a = ap.parse_args()
    exclude = {x for x in a.exclude_apps.split(",") if x}
    cat_mod = load(a.catalog)
    tasks = []
    for f in sorted(a.tasks.glob("*.py")):
        if f.name.startswith("_"):
            continue
        mod = load(f)
        for t in mod.TASKS:
            tasks.append({**t, "gold": train_convention(t["gold"]), "_file": f.stem})
    split = a.out / "synth"
    if split.exists():
        shutil.rmtree(split)
    (split / "synth_environment").mkdir(parents=True)
    shutil.copytree(KIT / "train/zaic_tools", split / "zaic_tools", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(a.apps, split / "zaic_tools/apps/synth_apps.py")
    catalog = json.loads((KIT / "train/train_tools_catalog.json").read_text(encoding="utf-8"))
    catalog["apps"] = catalog["apps"] + cat_mod.APPS
    (split / "synth_tools_catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    tools_of = {x["id"]: [t["name"] for t in x["tools"]] for x in catalog["apps"]}
    pool = train_contexts(min(3 * len(tasks), 1345), exclude, a.seed)
    rng = random.Random(a.seed)
    bases = []
    for t in tasks:          # contexts used once each while possible; history only when it cannot clash with the task
        want = not t.get("history") and rng.random() < a.history_rate
        def fits(b):
            h = b["history"]
            touched = {c["name"].split(".")[0] for x in h for c in x.get("tool_calls") or []}
            last = [x for x in h if x.get("role") == "assistant"][-1:]
            return bool(h) and not touched & set(t["states"]) and not (last and "?" in (last[0].get("text") or ""))
        pick = next((b for b in pool if fits(b)), None) if want else next((b for b in pool if not b["history"]), None)
        pick = pick or pool[0]
        pool.remove(pick) if len(pool) > 1 else None
        bases.append({**pick, "history": copy.deepcopy(pick["history"]) if want and fits(pick) else []})
    items = []
    for k, (t, base) in enumerate(zip(tasks, bases)):
        sid = f"synth_{k + 1:04d}"
        ctx = copy.deepcopy(base["context"])
        states = copy.deepcopy(base["states"])
        for app_id, st in t["states"].items():          # task apps (synthetic or TRAIN) replace the distractor state
            states[app_id] = copy.deepcopy(st)
            ctx["installed_apps"][app_id] = {"tools": tools_of[app_id]}
        for app_id in t.get("uninstall", []):            # out-of-scope tasks: make sure no installed app can do it
            states.pop(app_id, None)
            ctx["installed_apps"].pop(app_id, None)
        ctx["current_time"] = t["time"]
        if t.get("profile"):
            ctx["user_profile"] = {**ctx["user_profile"], **t["profile"]}
        names = sorted({n for v in ctx["installed_apps"].values() for n in v["tools"]})
        env_dir = split / "synth_environment" / sid
        env_dir.mkdir()
        meta = {"question_id": sid, "current_time": t["time"], "tools": names, "city": ctx["user_profile"].get("city")}
        (env_dir / "state.json").write_text(json.dumps({"_meta": meta, **states}, ensure_ascii=False), encoding="utf-8")
        items.append({"id": sid, "audio": f"audio/{sid}/{sid}.wav", "context": ctx, "history": copy.deepcopy(t.get("history") or base["history"]), "audio_text": t["text"],
                      "label": {"tool_calls": t["gold"]}, "synth": {"task": t.get("name"), "file": t["_file"], "context_from": base["from"]}})
    # replay the gold calls with the official Session of the new package (child process: separate zaic_tools copy)
    (split / "synth.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in items), encoding="utf-8")
    code = r'''
import json, sys, copy
sys.path.insert(0, sys.argv[1])
from zaic_tools import ToolEnv, TOOLS
rows, bad = [], []
for line in open(sys.argv[1] + "/synth.jsonl", encoding="utf-8"):
    x = json.loads(line)
    env = ToolEnv("synth", x["id"], root=sys.argv[2])
    before = env.get_state()
    results, err = [], None
    for c in x["label"]["tool_calls"]:
        v = env.validate(c["name"], c["arguments"])
        if not v["ok"]:
            err = f"schema: {c['name']}: {v['error']}"; break
        r = env.call(c["name"], c["arguments"])
        if TOOLS.get(c["name"]) == "write" and r.get("done") is False:
            err = f"no-op write: {c['name']}: {r.get('message')}"; break
        results.append(r)
    if err:
        bad.append({"id": x["id"], "task": x["synth"]["task"], "error": err}); continue
    after = env.get_state()
    x["label"]["tool_results"] = results
    x["label"]["final_state"] = {a: s for a, s in after.items() if s != before.get(a)}
    rows.append(x)
open(sys.argv[1] + "/synth.jsonl", "w", encoding="utf-8").write("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in rows))
print(json.dumps({"ok": len(rows), "bad": bad}, ensure_ascii=False))
'''
    res = subprocess.run([sys.executable, "-c", code, str(split), str(a.out)], capture_output=True, text=True)
    if res.returncode:
        raise SystemExit(res.stderr)
    report = json.loads(res.stdout)
    for b in report["bad"]:
        print("BAD", b)
    print(f"{report['ok']} samples ok, {len(report['bad'])} rejected; split at {split}")


if __name__ == "__main__":
    main()
