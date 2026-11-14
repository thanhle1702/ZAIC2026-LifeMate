"""Organizer scoring formula (Track 1), reimplemented for TRAIN diagnostics.

Per sample:
    gold list empty          -> 1 if the submitted list is empty, else 0
    hash_sys != hash_gold    -> 0
    M == 0                   -> 0
    otherwise                -> 2PR / (P + R), P = M / (M + U), R = M / |G|
Final score = 100 / N * sum(score_i).

A submitted call matches a gold call when the tool name is equal, every non-fuzzy argument is identical and every fuzzy
argument (catalog `x-match: fuzzy`) has token-F1 > 0.6 after lower-casing and Unicode NFC. Each call matches at most one call;
order is ignored (maximum bipartite matching). U = submitted calls left unmatched, schema-rejected calls included.

Assumptions where the statement is silent (kept strict, so the local number is a lower bound rather than an overestimate):
- fuzzy tokens are runs of letters/digits after NFC + lower-case (diacritics kept, punctuation dropped), counted as a multiset;
- an argument present on one side only is a mismatch (for a fuzzy key: token-F1 against an empty string = 0);
- non-fuzzy values are compared exactly (no case folding); lists keep their order; True is not equal to 1.
Tie-break score: the same F1 with the hash check dropped (`f1_no_hash`)."""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

FUZZY_THRESHOLD = 0.6


def fuzzy_keys(specs: dict[str, dict]) -> dict[str, frozenset[str]]:
    """tool name -> top-level argument names marked x-match: fuzzy in the catalog."""
    return {name: frozenset(k for k, p in ((spec.get("parameters") or {}).get("properties") or {}).items()
                            if isinstance(p, dict) and p.get("x-match") == "fuzzy")
            for name, spec in specs.items()}


def tokens(text: object) -> list[str]:
    if text is None:
        return []
    return re.findall(r"[^\W_]+", unicodedata.normalize("NFC", str(text)).lower())


def token_f1(predicted: object, gold: object) -> float:
    p, g = tokens(predicted), tokens(gold)
    if not p and not g:
        return 1.0
    common = sum((Counter(p) & Counter(g)).values())
    if not common:
        return 0.0
    precision, recall = common / len(p), common / len(g)
    return 2 * precision * recall / (precision + recall)


def identical(a: object, b: object) -> bool:
    if type(a) is bool or type(b) is bool:
        return type(a) is type(b) and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(identical(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(identical(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return type(a) is type(b) and a == b


def calls_match(predicted: dict, gold: dict, fuzzy: dict[str, frozenset[str]]) -> bool:
    if predicted.get("name") != gold.get("name"):
        return False
    pa, ga = predicted.get("arguments") or {}, gold.get("arguments") or {}
    if not isinstance(pa, dict) or not isinstance(ga, dict):
        return False
    soft = fuzzy.get(gold["name"], frozenset())
    for key in pa.keys() | ga.keys():
        if key in soft:
            if token_f1(pa.get(key), ga.get(key)) <= FUZZY_THRESHOLD:
                return False
        elif key not in pa or key not in ga or not identical(pa[key], ga[key]):
            return False
    return True


def matched_count(predicted: list[dict], gold: list[dict], fuzzy: dict[str, frozenset[str]]) -> int:
    """Maximum one-to-one matching between submitted and gold calls (Kuhn's augmenting paths)."""
    edges = [[j for j, g in enumerate(gold) if calls_match(p, g, fuzzy)] for p in predicted]
    owner: list[int | None] = [None] * len(gold)

    def augment(i: int, seen: set[int]) -> bool:
        for j in edges[i]:
            if j in seen:
                continue
            seen.add(j)
            if owner[j] is None or augment(owner[j], seen):
                owner[j] = i
                return True
        return False

    return sum(augment(i, set()) for i in range(len(predicted)))


def score_sample(predicted: list[dict], predicted_hash: str, gold: list[dict], gold_hash: str,
                 fuzzy: dict[str, frozenset[str]]) -> dict:
    if not gold:
        value = 1.0 if not predicted else 0.0
        return {"score": value, "f1_no_hash": value, "hash_match": predicted_hash == gold_hash, "matched": 0,
                "unmatched": len(predicted), "gold_calls": 0, "gold_empty": True}
    m = matched_count(predicted, gold, fuzzy)
    u = len(predicted) - m
    f1 = 0.0 if m == 0 else 2 * (m / (m + u)) * (m / len(gold)) / ((m / (m + u)) + (m / len(gold)))
    hash_match = predicted_hash == gold_hash
    return {"score": f1 if hash_match else 0.0, "f1_no_hash": f1, "hash_match": hash_match, "matched": m, "unmatched": u,
            "gold_calls": len(gold), "gold_empty": False}


def gold_hashes(root: Path, split: str, references: dict[str, dict], ids: list[str]) -> dict[str, str]:
    """Gold state hash of each sample: the gold calls replayed on a fresh ToolEnv (TRAIN labels only)."""
    from .toolenv import new_env
    out = {}
    for sample_id in ids:
        env = new_env(root, split, sample_id)
        for call in references[sample_id]["label"]["tool_calls"]:
            env.call(call["name"], call["arguments"])
        out[sample_id] = env.get_state_hash()
    return out


def summarize(per_sample: dict[str, dict]) -> dict:
    rows = list(per_sample.values())
    n = len(rows)
    if not n:
        raise ValueError("no samples to score")
    with_gold = [r for r in rows if not r["gold_empty"]]
    empty = [r for r in rows if r["gold_empty"]]
    return {
        "samples": n,
        "score": 100 * sum(r["score"] for r in rows) / n,
        "f1_no_hash": 100 * sum(r["f1_no_hash"] for r in rows) / n,
        "hash_match_percent": 100 * sum(r["hash_match"] for r in with_gold) / len(with_gold) if with_gold else None,
        "gold_empty_samples": len(empty),
        "gold_empty_correct": sum(r["score"] for r in empty),
        "lost_to_hash": sum(1 for r in with_gold if not r["hash_match"]),
        "lost_points_hash_mismatch": 100 * sum(r["f1_no_hash"] for r in with_gold if not r["hash_match"]) / n,
        "lost_points_extra_or_missing_calls": 100 * sum(1 - r["score"] for r in with_gold if r["hash_match"]) / n,
        "extra_calls": sum(r["unmatched"] for r in rows),
    }


def score_file(root: Path, split: str, predictions: Path, sample_ids: list[str] | None = None) -> tuple[dict, dict[str, dict]]:
    from .data import catalog, items
    references = {r["id"]: r for r in items(root, split)}
    rows = [json.loads(line) for line in predictions.read_text(encoding="utf-8").splitlines() if line.strip()]
    by_id = {r["id"]: r for r in rows}
    if len(by_id) != len(rows):
        raise ValueError("duplicate sample ids in predictions")
    ids = sample_ids or [r["id"] for r in rows]
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise ValueError(f"{len(missing)} sample(s) missing from predictions, e.g. {missing[:3]}")
    unknown = [i for i in ids if i not in references or "label" not in references[i]]
    if unknown:
        raise ValueError(f"no gold label for {len(unknown)} sample(s), e.g. {unknown[:3]}")
    fuzzy = fuzzy_keys(catalog(root, split))
    hashes = gold_hashes(root, split, references, ids)
    per_sample = {i: score_sample(by_id[i]["tool_calls"], by_id[i]["state_hash"], references[i]["label"]["tool_calls"],
                                  hashes[i], fuzzy) for i in ids}
    return summarize(per_sample), per_sample


def main() -> None:
    from .data import DATA_ROOT
    ap = argparse.ArgumentParser(description="Score a submission file on TRAIN with the organizer formula.")
    ap.add_argument("predictions", type=Path, help="JSONL with id, tool_calls, state_hash")
    ap.add_argument("--root", type=Path, default=DATA_ROOT)
    ap.add_argument("--split", default="train")
    ap.add_argument("--ids", type=Path, help="JSON list of sample ids to score (default: every row of the file)")
    ap.add_argument("--per-sample", type=Path, help="write per-sample scores to this JSONL")
    a = ap.parse_args()
    ids = json.loads(a.ids.read_text(encoding="utf-8")) if a.ids else None
    summary, per_sample = score_file(a.root, a.split, a.predictions, ids)
    if a.per_sample:
        with a.per_sample.open("w", encoding="utf-8") as out:
            for sample_id, row in per_sample.items():
                out.write(json.dumps({"id": sample_id, **row}, ensure_ascii=False) + "\n")
    json.dump(summary, sys.stdout, indent=2, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
