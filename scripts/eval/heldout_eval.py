"""Score a vote (or one adapter) on the held-out apps split (outputs/heldout/synth, built from synth/heldout/) with the organizer's
formula, through the Colab API (LIFEMATE_MODEL_API_URL / LIFEMATE_MODEL_API_KEY), the same agent loop and flags as the Docker image.

Text input: the written request, lower-cased like the ASR output (normalize_asr); no audio exists for synthetic samples, so this
measures transfer to unseen apps, not ASR robustness.

    python scripts/eval/heldout_eval.py --ensemble lifemate:E1P,lifemate_e1:E1,lifemate_synth:E1 --out results/heldout/vote_synth1
    python scripts/eval/heldout_eval.py --ensemble lifemate:E1P,lifemate_e1:E1,lifemate_synth2:E1 --out results/heldout/vote_synth2
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))
from lifemate.agent import execute  # noqa: E402
from lifemate.context import normalize_asr  # noqa: E402
from lifemate.data import catalog, installed_tools, items  # noqa: E402
from lifemate.ensemble import EnsembleChat  # noqa: E402
from lifemate.hosted_runner import RELEASE, Hosted  # noqa: E402
from lifemate.scoring import fuzzy_keys, score_sample  # noqa: E402
from lifemate.toolenv import new_env  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=PROJECT / "outputs/heldout")
    ap.add_argument("--split", default="synth")
    ap.add_argument("--ensemble", default="lifemate:E1P,lifemate_e1:E1,lifemate_synth:E1", help="served:orchestration,... (p1 first)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--seconds", type=float, default=60, help="per-sample budget (Colab round trips are slower than the A30)")
    a = ap.parse_args()
    if a.out.exists():
        raise SystemExit(f"{a.out} exists; use a new folder")
    members = [tuple(m.split(":", 1)) for m in a.ensemble.split(",") if m]
    hosted = Hosted(os.environ["LIFEMATE_MODEL_API_URL"], os.environ["LIFEMATE_MODEL_API_KEY"])
    identity = hosted.request("/v1/models")
    served = {m["id"] for m in identity.get("data", [])}
    if identity.get("release_revision") != RELEASE or not {n for n, _ in members} <= served:
        raise SystemExit(f"Colab serves {sorted(served)}, the vote needs {[n for n, _ in members]}")
    for name, _ in members:   # every member must answer, not only be listed
        hosted.for_model(name).complete([{"role": "user", "content": "ping"}], [{"type": "function", "function": {
            "name": "noop", "description": "no-op", "parameters": {"type": "object", "properties": {}}}}], timeout=60)
    specs = catalog(a.root, a.split)
    fuzzy = fuzzy_keys(specs)
    samples = list(items(a.root, a.split))[: a.limit or None]
    a.out.mkdir(parents=True)
    llm = EnsembleChat(None, members, client=hosted.for_model) if len(members) > 1 else hosted.for_model(members[0][0])
    rows = []
    with (a.out / "trace.jsonl").open("w", encoding="utf-8") as trace:
        for k, item in enumerate(samples, 1):
            start = time.monotonic()
            env = new_env(a.root, a.split, item["id"])
            texts = {t["audio"]: t.get("audio_text", "") for t in item.get("history", []) if t.get("audio")}
            transcript = normalize_asr(item["audio_text"])
            view = {key: item[key] for key in ("id", "audio", "context", "history")}
            view["history"] = [{kk: vv for kk, vv in t.items() if kk != "audio_text"} for t in view["history"]]
            tools = installed_tools(view, specs)
            termination = {}

            def log(kind, record):
                if kind == "terminations":
                    termination.update(record)
                trace.write(json.dumps({"sample_id": item["id"], "event": kind, **record}, ensure_ascii=False, default=str) + "\n")

            error = None
            try:
                if hasattr(llm, "bind"):
                    llm.bind(view, transcript, tools)
                    llm.last_votes = []
                execute(view, transcript, tools, env, llm, lambda rel: normalize_asr(texts.get(rel, "")), log, max_turns=10,
                        deadline_seconds=a.seconds, orchestration=members[0][1], dedup_calls=True, retry_cap=2)
            except Exception as exc:   # the line keeps the calls already made, as in Docker
                error = f"{type(exc).__name__}: {exc}"
            gold = new_env(a.root, a.split, item["id"])
            for c in item["label"]["tool_calls"]:
                gold.call(c["name"], c["arguments"])
            score = score_sample(env.get_tool_calls(), env.get_state_hash(), item["label"]["tool_calls"], gold.get_state_hash(), fuzzy)
            rows.append({"id": item["id"], "task": item["synth"]["task"], "score": score["score"], "f1_no_hash": score["f1_no_hash"],
                         "hash_match": score["hash_match"], "status": termination.get("status"), "error": error,
                         "seconds": round(time.monotonic() - start, 1), "predicted": env.get_tool_calls(), "gold": item["label"]["tool_calls"],
                         "text": item["audio_text"], "votes": getattr(llm, "last_votes", None)})
            (a.out / "rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
            mean = 100 * sum(r["score"] for r in rows) / len(rows)
            print(f"{k}/{len(samples)} {item['id']} {rows[-1]['task']}: {score['score']:.2f} (running {mean:.2f})", flush=True)
    by = defaultdict(list)
    for r in rows:
        by[r["task"].split("_")[1] + "_" + "_".join(r["task"].split("_")[2:-1])].append(r["score"])
    summary = {"ensemble": a.ensemble, "n": len(rows), "score": round(100 * sum(r["score"] for r in rows) / len(rows), 2),
               "hash_match": sum(r["hash_match"] for r in rows), "errors": sum(bool(r["error"]) for r in rows),
               "status": Counter(r["status"] for r in rows), "by_kind": {k: round(100 * sum(v) / len(v), 1) for k, v in sorted(by.items())}}
    (a.out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
