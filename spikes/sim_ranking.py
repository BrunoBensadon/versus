"""THROWAWAY SPIKE — ranking simulation with synthetic "true" preferences.

Questions:
  Q1. Comparisons needed to seed n games, with 3 buckets vs. 1 bucket.
  Q2. How much noise (inconsistent answers) degrades the order.
  Q3. "Too close" handling: neighbour-pivot vs. immediate placement — cost and accuracy.
  Q4. Insertion replay vs. Bradley-Terry fit of the same log: which is closer to the truth?
  Q5. Do sanity-check comparisons (adjacent, weakly supported pairs) repair noisy orders?

Model of the user:
  - true enjoyment u ~ N(0, 1) per game
  - bucket = terciles-ish of u: top 30% loved, middle 45% liked, bottom 25% didn't like,
    optionally with bucket mistakes (a game near a boundary lands in the neighbouring bucket)
  - answer noise, two variants:
      'flip'     : constant probability eps of giving the wrong answer
      'logistic' : P(prefer A) = sigmoid((uA - uB) / T)  (close games are confused more often)
  - "too close": if |uA - uB| < delta the user taps "too close" instead of answering
"""
import math
import random
import statistics

import numpy as np
from scipy.stats import kendalltau

BUCKET_SHARES = (0.30, 0.45, 0.25)  # loved, liked, didn't like (top → bottom)


# ---------------------------------------------------------------- user model
class User:
    def __init__(self, u, noise="flip", eps=0.0, T=0.1, delta=0.0, rng=None):
        self.u, self.noise, self.eps, self.T, self.delta = u, noise, eps, T, delta
        self.rng = rng or random.Random(0)

    def compare(self, a, b):
        """Returns 1 if a preferred, -1 if b preferred, 0 for 'too close'."""
        d = self.u[a] - self.u[b]
        if abs(d) < self.delta:
            return 0
        if self.noise == "flip":
            right = 1 if d > 0 else -1
            return -right if self.rng.random() < self.eps else right
        p = 1 / (1 + math.exp(-d / self.T))
        return 1 if self.rng.random() < p else -1


def buckets_for(u, n_buckets, mistake=0.0, rng=None):
    order = sorted(range(len(u)), key=lambda i: -u[i])
    if n_buckets == 1:
        return {i: 0 for i in order}
    cuts, acc = [], 0
    for s in BUCKET_SHARES[:-1]:
        acc += s
        cuts.append(round(acc * len(u)))
    b = {}
    for pos, i in enumerate(order):
        b[i] = sum(pos >= c for c in cuts)
    if mistake and rng:  # games within mistake*n of a boundary may be put in the adjacent bucket
        w = max(1, int(mistake * len(u)))
        for c in cuts:
            for pos in range(max(0, c - w), min(len(u), c + w)):
                if rng.random() < 0.5:
                    i = order[pos]
                    b[i] = (sum(pos >= cc for cc in cuts) + (1 if pos < c else -1))
                    b[i] = min(max(b[i], 0), n_buckets - 1)
    return b


# ---------------------------------------------------------------- insertion
def binary_insert(lst, g, user, log, too_close="neighbour"):
    """Insert g into lst (best first). Returns #questions asked. Appends to log."""
    lo, hi, asked = 0, len(lst), 0
    while lo < hi:
        mid = (lo + hi) // 2
        r = user.compare(g, lst[mid]); asked += 1
        log.append((g, lst[mid], r))
        if r == 0 and too_close == "neighbour":
            # g ≈ lst[mid]. Ask once against an adjacent pivot inside the search interval.
            if mid + 1 < hi:                      # worse neighbour exists
                alt = mid + 1
                r2 = user.compare(g, lst[alt]); asked += 1; log.append((g, lst[alt], r2))
                if r2 < 0:                        # worse than the worse neighbour → keep searching below
                    lo = alt + 1
                    continue
                lo = hi = mid + 1                 # between mid and alt (or tie again) → right after mid
                break
            if mid - 1 >= lo:                     # better neighbour exists
                alt = mid - 1
                r2 = user.compare(g, lst[alt]); asked += 1; log.append((g, lst[alt], r2))
                if r2 > 0:                        # better than the better neighbour → keep searching above
                    hi = alt
                    continue
                lo = hi = mid                     # between alt and mid → right before mid
                break
            lo = hi = mid + 1                     # no neighbour in range → right after mid
            break
        if r == 0:  # 'place' strategy: tie → right after the pivot
            lo = hi = mid + 1
            break
        if r > 0:
            hi = mid
        else:
            lo = mid + 1
    lst.insert(lo, g)
    return asked


def seed(n_games, user, n_buckets, bucket_of, too_close="neighbour", rng=None):
    lists = [[] for _ in range(n_buckets)]
    log, cost = [], 0
    order = list(range(n_games))
    (rng or random).shuffle(order)
    for g in order:
        cost += binary_insert(lists[bucket_of[g]], g, user, log, too_close)
    return [g for l in lists for g in l], cost, log, lists


# ---------------------------------------------------------------- metrics / BT
def tau(order, u):
    true_rank = {g: r for r, g in enumerate(sorted(range(len(u)), key=lambda i: -u[i]))}
    return kendalltau([true_rank[g] for g in order], list(range(len(order)))).statistic


def max_displacement(order, u):
    true_rank = {g: r for r, g in enumerate(sorted(range(len(u)), key=lambda i: -u[i]))}
    return max(abs(true_rank[g] - i) for i, g in enumerate(order))


def bradley_terry(n, pairs, bucket_of=None, n_buckets=1, iters=300, l2=0.01):
    """MAP Bradley-Terry by gradient ascent. pairs: (winner, loser, weight). Ties = half win each."""
    s = np.zeros(n)
    W = np.array([p[0] for p in pairs]); L = np.array([p[1] for p in pairs])
    wt = np.array([p[2] for p in pairs], dtype=float)
    lr = 0.5
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(s[W] - s[L])))
        g = np.zeros(n)
        np.add.at(g, W, wt * (1 - p))
        np.add.at(g, L, -wt * (1 - p))
        g -= l2 * s
        s += lr * g / max(1.0, wt.sum() / n)
    if bucket_of is not None and n_buckets > 1:
        # buckets are a hard partition: sort by bucket, then by BT strength inside
        return sorted(range(n), key=lambda i: (bucket_of[i], -s[i])), s
    return sorted(range(n), key=lambda i: -s[i]), s


def log_to_pairs(log):
    out = []
    for a, b, r in log:
        if r > 0: out.append((a, b, 1.0))
        elif r < 0: out.append((b, a, 1.0))
        else: out += [(a, b, 0.5), (b, a, 0.5)]
    return out


def sanity_pass(order_lists, user, log, budget, rng):
    """Ask `budget` checks on adjacent pairs inside buckets, preferring pairs with the least direct
    evidence; a contradiction flags the lower game, which is then re-inserted."""
    asked = 0
    support = {}
    for a, b, r in log:
        support[frozenset((a, b))] = support.get(frozenset((a, b)), 0) + 1
    while asked < budget:
        cands = []
        for bi, l in enumerate(order_lists):
            for i in range(len(l) - 1):
                cands.append((support.get(frozenset((l[i], l[i + 1])), 0), rng.random(), bi, i))
        if not cands: break
        cands.sort()
        _, _, bi, i = cands[0]
        l = order_lists[bi]; a, b = l[i], l[i + 1]
        r = user.compare(a, b); asked += 1; log.append((a, b, r))
        support[frozenset((a, b))] = support.get(frozenset((a, b)), 0) + 1
        if r < 0:  # contradiction: re-insert the lower game b
            l.remove(b)
            asked += binary_insert(l, b, user, log)
    return [g for l in order_lists for g in l], asked


# ---------------------------------------------------------------- experiments
def run(n, n_buckets, noise="flip", eps=0.0, T=0.1, delta=0.0, mistake=0.0, too_close="neighbour",
        reps=40, sanity_budget=0, seed0=0):
    costs, taus, taus_bt, disp, taus_san, san_cost = [], [], [], [], [], []
    for r in range(reps):
        rng = random.Random(seed0 + r)
        u = [rng.gauss(0, 1) for _ in range(n)]
        user = User(u, noise, eps, T, delta, random.Random(10_000 + r))
        b = buckets_for(u, n_buckets, mistake, rng)
        order, cost, log, lists = seed(n, user, n_buckets, b, too_close, rng)
        costs.append(cost); taus.append(tau(order, u)); disp.append(max_displacement(order, u))
        bt_order, _ = bradley_terry(n, log_to_pairs(log), b, n_buckets)
        taus_bt.append(tau(bt_order, u))
        if sanity_budget:
            o2, c2 = sanity_pass([list(l) for l in lists], user, list(log), sanity_budget, rng)
            taus_san.append(tau(o2, u)); san_cost.append(c2)
    res = dict(n=n, buckets=n_buckets, cost=statistics.mean(costs), cost_per_game=statistics.mean(costs) / n,
               tau=statistics.mean(taus), tau_p10=sorted(taus)[len(taus) // 10],
               tau_bt=statistics.mean(taus_bt), maxdisp=statistics.mean(disp))
    if sanity_budget:
        res.update(tau_sanity=statistics.mean(taus_san), sanity_cost=statistics.mean(san_cost))
    return res


def theoretical(n, k):
    # sum of ceil(log2(m+1)) for inserting into lists of size 0..size-1, per bucket
    sizes = [round(s * n) for s in BUCKET_SHARES] if k == 3 else [n]
    return sum(sum(math.ceil(math.log2(m + 1)) for m in range(sz)) for sz in sizes), \
        sum(math.lgamma(sz + 1) / math.log(2) for sz in sizes)


if __name__ == "__main__":
    print("Q1. Seeding cost (no noise)")
    print(f"{'n':>4} {'buckets':>7} {'sim cost':>9} {'/game':>6} {'Σceil(log2)':>12} {'log2(n!)':>9}")
    for n in (60, 100, 200):
        for k in (1, 3):
            r = run(n, k, reps=20)
            th, lb = theoretical(n, k)
            print(f"{n:>4} {k:>7} {r['cost']:>9.0f} {r['cost_per_game']:>6.2f} {th:>12} {lb:>9.0f}")
    print("  marginal cost of the NEXT game once seeded (3 buckets, worst bucket = liked, 45%):")
    for n in (60, 100, 200):
        print(f"    n={n}: liked bucket ~{round(.45 * n)} games → {math.ceil(math.log2(round(.45 * n) + 1))} questions max")

    print("\nQ2. Noise → order quality (n=100, 3 buckets, perfect bucket choice). tau = Kendall τ vs truth")
    print(f"{'noise':>22} {'τ insert':>9} {'τ p10':>7} {'τ BT':>7} {'max displ.':>11}")
    print(f"{'none':>22}", *(f"{v:>9.3f}" if i < 3 else f"{v:>11.1f}" for i, v in
          enumerate(map(run(100, 3).get, ('tau', 'tau_p10', 'tau_bt', 'maxdisp')))))
    for eps in (0.05, 0.10, 0.20):
        r = run(100, 3, "flip", eps)
        print(f"{'flip eps=' + str(eps):>22} {r['tau']:>9.3f} {r['tau_p10']:>7.3f} {r['tau_bt']:>7.3f} {r['maxdisp']:>11.1f}")
    for T in (0.05, 0.15, 0.30):
        r = run(100, 3, "logistic", T=T)
        print(f"{'logistic T=' + str(T):>22} {r['tau']:>9.3f} {r['tau_p10']:>7.3f} {r['tau_bt']:>7.3f} {r['maxdisp']:>11.1f}")
    print("  same, 1 bucket (no buckets):")
    for eps in (0.05, 0.10):
        r = run(100, 1, "flip", eps)
        print(f"{'flip eps=' + str(eps):>22} {r['tau']:>9.3f} {r['tau_p10']:>7.3f} {r['tau_bt']:>7.3f} {r['maxdisp']:>11.1f}")
    print("  bucket mistakes (5% of n around each boundary may land in the neighbour bucket), flip 0.05:")
    r = run(100, 3, "flip", 0.05, mistake=0.05)
    print(f"{'flip .05 + bucket err':>22} {r['tau']:>9.3f} {r['tau_p10']:>7.3f} {r['tau_bt']:>7.3f} {r['maxdisp']:>11.1f}")

    print("\nQ3. 'Too close' (n=100, 3 buckets, logistic T=0.15). delta = gap under which user taps 'too close'")
    for delta in (0.02, 0.05):
        for tc in ("neighbour", "place"):
            r = run(100, 3, "logistic", T=0.15, delta=delta, too_close=tc)
            print(f"  delta={delta} {tc:>9}: cost {r['cost']:.0f} ({r['cost_per_game']:.2f}/game), τ {r['tau']:.3f}, τ BT {r['tau_bt']:.3f}")

    print("\nQ5. Sanity checks after seeding (n=100, 3 buckets, flip eps=0.10)")
    for budget in (0, 25, 50, 100):
        r = run(100, 3, "flip", 0.10, sanity_budget=budget or 0, reps=30)
        extra = f", τ after {r['tau_sanity']:.3f} (+{r['sanity_cost']:.0f} questions incl. re-inserts)" if budget else ""
        print(f"  budget {budget:>3}: τ seed {r['tau']:.3f}{extra}")
