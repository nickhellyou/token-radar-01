# nickhellyou/token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/nickhellyou/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/nickhellyou/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: 200 pre-token protocols ranked by implied value, fitted from the 128 protocols whose token already trades. Each row carries a costed 12-week farm plan with fees, yield forgone, break-even odds and a FARM / MARGINAL / SKIP verdict that re-prices for any deposit size and drop share.

## How it works

The model is fitted from the snapshot on every run, never a hand-kept list of names:

- **Size curve:** OLS of log(market cap) on log(TVL) over the 128 trading protocols: log(mcap) = 6.96 + 0.522 · log(TVL).
- **Category premium:** median log(mcap/TVL) per category against the global median, shrunk toward 1 for small categories.
- **Forward TVL:** TVL carried one quarter on its 7-day change, capped at ±20%.
- **Launch odds:** an age curve, 0.20 for a newborn rising toward 0.75, plus a bump when TVL is growing.
- **Implied value** = exp(a + b · ln(forward TVL)) × category premium × launch odds, with a P10–P90 band from the fit's own residuals.
- **Validation:** the curve is re-fitted on two of every three trading protocols and scored on the held-out third. Held out 43 tokens: median miss 232.6%, 28% within 2x of the real market cap, 81% within 10x. The board prints that miss rate instead of pretending precision.

The board covers all 40 watchlist protocols plus the 160 pre-token protocols below the $50M floor with the highest implied value. Protocols whose token already trades are kept apart in the "Already trading" tab and serve as the comparables the curve was fitted on.

A farmer's slice of a drop is their deposit's share of the farming TVL (10% of TVL) times the drop share of the value if it launches. Costs are gas on the protocol's first chain plus yield forgone at 4% APY over 12 weeks; break-even odds = all-in cost / slice.

Implied values are this radar's claim, never make.fun's. A record of no token is not proof there is none; nothing here says if or when a token launches.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18 or later, standard library only, no network. `main.ts` reads the sealed snapshot, writes `out/board.json` (200 rows), `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`. Run it twice and the outputs are byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
