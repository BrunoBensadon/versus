"""THROWAWAY SPIKE — which sanity-check strategy actually repairs a noisy order? (n=100, 3 buckets, flip eps)"""
import random, statistics
from sim_ranking import User, buckets_for, seed, tau, binary_insert

def strat_adjacent(lists, user, log, rng):
    bi = rng.randrange(3); l = lists[bi]
    if len(l) < 2: return 0
    i = rng.randrange(len(l) - 1); a, b = l[i], l[i + 1]
    r = user.compare(a, b); n = 1
    if r < 0: l.remove(b); n += binary_insert(l, b, user, log, "place")
    return n

def strat_far_pair(lists, user, log, rng):
    # random pair in the same bucket at least 1/4 of the bucket apart; contradiction → re-insert both
    bi = rng.randrange(3); l = lists[bi]
    if len(l) < 8: return 0
    i, j = sorted(rng.sample(range(len(l)), 2))
    if j - i < len(l) // 4: return 0
    a, b = l[i], l[j]; r = user.compare(a, b); n = 1
    if r < 0:
        for g in (a, b): l.remove(g); n += binary_insert(l, g, user, log, "place")
    return n

def strat_reinsert(lists, user, log, rng):
    # re-insert a random game from scratch (the "would you still put it here?" check)
    bi = rng.randrange(3); l = lists[bi]
    if not l: return 0
    g = rng.choice(l); l.remove(g); return binary_insert(l, g, user, log, "place")

def strat_reinsert_least(lists, user, log, rng, _count={}):
    # re-insert the game with the fewest comparisons involving it so far (oldest/weakest support)
    cnt = {}
    for a, b, _ in log: cnt[a] = cnt.get(a, 0) + 1; cnt[b] = cnt.get(b, 0) + 1
    bi, g = min(((bi, g) for bi, l in enumerate(lists) for g in l), key=lambda x: (cnt.get(x[1], 0), rng.random()))
    lists[bi].remove(g); return binary_insert(lists[bi], g, user, log, "place")

STRATS = dict(adjacent=strat_adjacent, far_pair=strat_far_pair, reinsert_random=strat_reinsert,
              reinsert_least_supported=strat_reinsert_least)
for eps in (0.05, 0.10):
    print(f"flip eps={eps}: mean τ after seeding and after N extra questions (30 reps)")
    for name, f in STRATS.items():
        res = {0: [], 50: [], 100: [], 200: []}
        for r in range(30):
            rng = random.Random(r); u = [rng.gauss(0, 1) for _ in range(100)]
            user = User(u, "flip", eps, rng=random.Random(9000 + r)); b = buckets_for(u, 3)
            order, cost, log, lists = seed(100, user, 3, b, "place", rng)
            res[0].append(tau(order, u)); spent = 0
            for budget in (50, 100, 200):
                while spent < budget: spent += f(lists, user, log, rng)
                res[budget].append(tau([g for l in lists for g in l], u))
        print(f"   {name:26}" + "  ".join(f"+{k:<3}→ {statistics.mean(v):.3f}" for k, v in res.items()))
