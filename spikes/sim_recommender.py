"""THROWAWAY SPIKE — can a readable linear model learn taste from ~65 ranked games, on REAL features?

Features: Bruno's real library metadata (IGDB + Steam tags, spikes/raw/*). Taste: SYNTHETIC.
  true utility u = x · w_true + idiosyncratic noise, with a chosen share of variance that is
  learnable from features ("signal share"). Bruno's real share is unknown until he ranks games.
Comparisons: produced by the simulated ranking flow (3 buckets, 5% answer errors).
Evaluation: repeated 5-fold over games. Held-out games' comparisons and bucket pairs are removed.
  pairwise accuracy = held-out game vs. every training game, sign agreement with true order
  tau = Kendall τ among held-out games
"""
import json
import random
import statistics
from collections import Counter

import numpy as np
from scipy.stats import kendalltau
from sklearn.linear_model import LogisticRegression, Ridge

from _common import RAW
from sim_ranking import User, buckets_for, seed

STOP = {"steam", "digital distribution", "steam achievements", "achievements", "steam cloud",
        "steam trading cards", "steam workshop", "overlay", "pc", "windows", "dlc",
        "downloadable content", "xbox one x enhanced", "playstation trophies", "online"}

games = json.loads((RAW / "library_igdb_games.json").read_text(encoding="utf-8"))
stags = json.loads((RAW / "library_steam_tags.json").read_text(encoding="utf-8"))
cov = json.loads((RAW.parent / "fixtures" / "library_coverage.json").read_text(encoding="utf-8"))["games"]
igdb_to_app = {c["igdb_id"]: str(c["appid"]) for c in cov}
games = [g for g in games if g["id"] in igdb_to_app and g.get("game_type", {}).get("type") != "Bundle"]


def build(games, use_steam=True, min_df=3):
    blocks = {}
    for g in games:
        b = {
            "genre": {x["name"]: 1.0 for x in g.get("genres") or []},
            "theme": {x["name"]: 1.0 for x in g.get("themes") or []},
            "mode": {x["name"]: 1.0 for x in g.get("game_modes") or []},
            "persp": {x["name"]: 1.0 for x in g.get("player_perspectives") or []},
            "kw": {x["name"]: 1.0 for x in g.get("keywords") or [] if x["name"].lower() not in STOP},
        }
        tags = stags.get(igdb_to_app[g["id"]], []) if use_steam else []
        if tags:
            m = max(t["weight"] for t in tags)
            b["tag"] = {str(t["tagid"]): t["weight"] / m for t in tags}
        blocks[g["id"]] = b
    df = Counter((bn, f) for b in blocks.values() for bn, d in b.items() for f in d)
    vocab = sorted(k for k, c in df.items() if c >= min_df)
    idx = {k: i for i, k in enumerate(vocab)}
    X = np.zeros((len(games), len(vocab) + 1))
    for r, g in enumerate(games):
        for bn, d in blocks[g["id"]].items():
            cols = [(idx[(bn, f)], v) for f, v in d.items() if (bn, f) in idx]
            norm = np.sqrt(sum(v * v for _, v in cols)) or 1.0
            for c, v in cols:
                X[r, c] = v / norm  # each block has unit L2 norm → no block dominates by size
        X[r, -1] = 1.0 if "tag" in blocks[g["id"]] else 0.0
    genre_sets = [set(blocks[g["id"]]["genre"]) for g in games]
    return X, vocab, genre_sets


def fit_pairwise(X, pairs, C):
    D = np.array([X[a] - X[b] for a, b, _ in pairs] + [X[b] - X[a] for a, b, _ in pairs])
    y = np.array([1] * len(pairs) + [0] * len(pairs))
    sw = np.array([w for *_, w in pairs] * 2)
    m = LogisticRegression(C=C, fit_intercept=False, max_iter=2000)
    m.fit(D, y, sample_weight=sw)
    return m.coef_[0]


def evaluate(X, genre_sets, n_games, signal, reps=6, rng_seed=0):
    out = {k: {"acc": [], "tau": []} for k in
           ("genre_avg", "knn", "ridge_score", "logit_log", "logit_log+bucket", "logit_allorder")}
    for rep in range(reps):
        rng = random.Random(rng_seed + rep)
        sel = rng.sample(range(len(X)), n_games)
        Xs = X[sel]
        nrng = np.random.default_rng(rep)
        w_true = np.zeros(X.shape[1])
        active = nrng.choice(X.shape[1] - 1, 15, replace=False)
        w_true[active] = nrng.normal(0, 1, 15)
        f = Xs @ w_true
        f = (f - f.mean()) / (f.std() or 1)
        u = list(np.sqrt(signal) * f + np.sqrt(1 - signal) * nrng.normal(0, 1, n_games))
        user = User(u, "flip", 0.05, rng=random.Random(500 + rep))
        b = buckets_for(u, 3)
        order, _, log, _ = seed(n_games, user, 3, b, "place", rng)
        pos = {g: i for i, g in enumerate(order)}
        score = {g: 10 - 10 * pos[g] / (n_games - 1) for g in order}  # simple position score
        folds = [list(range(n_games))[i::5] for i in range(5)]
        rng.shuffle(order)
        for fold in folds:
            test = set(fold); train = [g for g in range(n_games) if g not in test]
            # training signals
            rec = [(a, bb, 1.0) if r > 0 else (bb, a, 1.0) for a, bb, r in log
                   if r != 0 and a not in test and bb not in test]
            bucket_pairs = []
            for a in train:
                others = [g for g in train if b[g] > b[a]]  # higher bucket index = worse bucket
                for g in rng.sample(others, min(5, len(others))):
                    bucket_pairs.append((a, g, 0.5))
            tr_sorted = sorted(train, key=lambda g: pos[g])
            allorder = [(tr_sorted[i], tr_sorted[j], 1.0) for i in range(len(tr_sorted))
                        for j in range(i + 1, len(tr_sorted))]
            preds = {}
            preds["logit_log"] = Xs @ fit_pairwise(Xs, rec, C=1.0)
            preds["logit_log+bucket"] = Xs @ fit_pairwise(Xs, rec + bucket_pairs, C=1.0)
            preds["logit_allorder"] = Xs @ fit_pairwise(Xs, allorder, C=0.3)
            rd = Ridge(alpha=3.0).fit(Xs[train], [score[g] for g in train])
            preds["ridge_score"] = rd.predict(Xs)
            # genre-average baseline
            ga = np.zeros(n_games)
            for g in range(n_games):
                s = [score[t] for t in train if genre_sets[sel[g]] & genre_sets[sel[t]]]
                ga[g] = statistics.mean(s) if s else statistics.mean(score[t] for t in train)
            preds["genre_avg"] = ga
            # kNN: cosine similarity, score-weighted top-5
            nrm = Xs / (np.linalg.norm(Xs, axis=1, keepdims=True) + 1e-9)
            S = nrm @ nrm.T
            kn = np.zeros(n_games)
            for g in range(n_games):
                nb = sorted(train, key=lambda t: -S[g, t])[:5]
                wsum = sum(max(S[g, t], 0) for t in nb) or 1
                kn[g] = sum(max(S[g, t], 0) * score[t] for t in nb) / wsum
            preds["knn"] = kn
            for k, p in preds.items():
                agree = [(p[h] > p[t]) == (u[h] > u[t]) for h in test for t in train if p[h] != p[t]]
                out[k]["acc"].append(np.mean(agree) if agree else 0.5)
                tl = list(test)
                out[k]["tau"].append(kendalltau([p[g] for g in tl], [u[g] for g in tl]).statistic)
    return {k: (np.mean(v["acc"]), np.nanmean(v["tau"])) for k, v in out.items()}


if __name__ == "__main__":
    for use_steam in (True, False):
        X, vocab, gs = build(games, use_steam)
        blocks = Counter(bn for bn, _ in vocab)
        print(f"\nFeatures ({'IGDB + Steam tags' if use_steam else 'IGDB only'}): {len(vocab)} "
              f"after min_df>=3 & stop-list  {dict(blocks)}; games={len(games)}; "
              f"nonzeros/game median {int(np.median((X[:, :-1] > 0).sum(1)))}")
        if not use_steam:
            print("  (synthetic taste below is generated from IGDB-only features too — see caveat)")
        for n in (40, 65, 100):
            if n > len(games): continue
            for signal in (0.3, 0.6):
                r = evaluate(X, gs, n, signal)
                print(f"  n={n:<3} signal={signal}:  " + "  ".join(
                    f"{k} {a:.3f}/{t:.2f}" for k, (a, t) in r.items()))
    print("\n  cells = held-out pairwise accuracy / Kendall τ among held-out games. 0.5 = chance.")
