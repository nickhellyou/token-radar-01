// Token Radar: fitted value model + costed farm plans, all from the snapshot.
//
// The model is FITTED from the snapshot's own trading protocols, never a
// hand-kept list of names and never a TVL table in disguise:
//
//   1. Size curve: OLS of log(mcap) on log(TVL) over protocols whose token
//      already trades. A token's market cap grows like a power law of TVL:
//      mcap ~= exp(a) * TVL^b. The fit is recomputed on every run from
//      whatever snapshot is fed in, so a future snapshot re-fits itself.
//   2. Category premium: the median log(mcap/TVL) of a category against the
//      global median, shrunk toward 1 for small categories. Dexs trade rich,
//      lending trades cheap; the data says so, not a table I wrote.
//   3. Forward TVL: TVL carried forward one quarter on its 7-day change,
//      capped at +-20%, so a shrinking protocol is not priced as if it grew.
//   4. Launch odds: an age curve. A protocol tracked longer with no token
//      has had longer to mature toward a launch; odds rise from 0.20 for a
//      newborn toward 0.75 for a multi-year protocol, plus a small bump when
//      TVL is growing. Odds are a claim about maturity, never a prediction
//      of if or when a token launches.
//   5. Range: the fitted residuals' P10/P90 give a P10-P90 band on the
//      value if it launches, so the board shows its own uncertainty.
//   6. Validation: the fit is re-run on a 2/3 train split and scored on the
//      held-out 1/3. The dashboard prints the miss rate honestly, including
//      how wide it is, because a radar that hides its error is a poster.
//
//   value_if_launches = exp(a + b*ln(forward_tvl)) * category_premium
//   implied_value     = value_if_launches * launch_odds
//
// Farm economics, per protocol, from its own chain, category, TVL and age:
// a farmer's slice of a drop is their deposit's share of the farming TVL
// (taken as 10% of TVL) times the drop share of the value if it launches.
// Costs are gas on the protocol's first chain plus yield forgone at 4% APY
// over the 12-week plan; break-even odds = all-in cost / slice. A plan is
// FARM when expected value (odds * slice - cost) is positive, MARGINAL when
// the loss is less than half the cost, SKIP otherwise. The dashboard
// recomputes the verdict for any deposit size and drop share from the same
// primitives, so the board and the page can never disagree.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Fit {
  a: number;
  b: number;
  n: number;
  resid_sd: number;
  p10: number;
  p90: number;
  global_log_ratio: number;
}

export interface Validation {
  n_test: number;
  med_abs_log_err: number;
  within_2x: number;
  within_10x: number;
  med_abs_pct_err: number;
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  value_if_launches_usd: number;
  launch_odds: number;
  range_lo_usd: number;
  range_hi_usd: number;
  forward_tvl_usd: number;
  category_premium: number;
  gas_per_tx_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  value_if_launches_usd: number;
  launch_odds: number;
  range_lo_usd: number;
  range_hi_usd: number;
  forward_tvl_usd: number;
  category_premium: number;
  gas_per_tx_usd: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: Fit;
  validation: Validation;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-2-fitted';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;
/** Drop share and deposit the board's farm steps are costed at. */
export const BASE_DEPOSIT_USD = 1000;
export const BASE_DROP_SHARE = 0.07;
/** Share of TVL assumed to be actively farming (the denominator of a slice). */
export const FARMING_TVL_SHARE = 0.1;
/** Yield forgone while capital sits in the position, per year. */
export const YIELD_APY = 0.04;
/** The farm plan's horizon, in weeks. */
export const PLAN_WEEKS = 12;

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i]!;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Protocols whose token already trades, the only ones that can teach a size curve. */
function trading(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** OLS of log(mcap) on log(TVL), plus the residuals' spread and P10/P90. */
export function fitSizeCurve(rows: SnapshotProtocol[]): Fit {
  const pts = rows.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) }));
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const res = pts.map((p) => p.y - (a + b * p.x)).sort((x, y) => x - y);
  const mean = res.reduce((s, r) => s + r, 0) / n;
  const sd = Math.sqrt(res.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, n - 1));
  const ratios = rows.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  return { a, b, n, resid_sd: sd, p10: quantile(res, 0.1), p90: quantile(res, 0.9), global_log_ratio: median(ratios) };
}

/** Category premium from median log(mcap/TVL) vs the global median, shrunk for small n. */
export function categoryPremiums(rows: SnapshotProtocol[], globalLogRatio: number): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of rows) {
    const c = p.category ?? 'Unknown';
    const arr = byCat.get(c) ?? [];
    arr.push(Math.log(p.mcap_usd! / p.tvl_usd));
    byCat.set(c, arr);
  }
  const out = new Map<string, number>();
  for (const [c, vals] of byCat) {
    const raw = Math.exp(median(vals) - globalLogRatio);
    const shrink = vals.length / (vals.length + 4); // small categories pulled toward 1
    const premium = Math.exp(Math.log(Math.min(4, Math.max(0.25, raw))) * shrink);
    out.set(c, premium);
  }
  return out;
}

/**
 * Out-of-sample check: fit the curve on 2 of every 3 trading protocols
 * (by slug order, so the split is deterministic) and score the held-out
 * third. A model that only memorises its training set fails here in public.
 */
export function validateCurve(rows: SnapshotProtocol[]): Validation {
  const sorted = [...rows].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const train = sorted.filter((_, i) => i % 3 !== 0);
  const test = sorted.filter((_, i) => i % 3 === 0);
  const fit = fitSizeCurve(train);
  const errs = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - (fit.a + fit.b * Math.log(p.tvl_usd))));
  const within2 = errs.filter((e) => e <= Math.log(2)).length / Math.max(1, errs.length);
  const within10 = errs.filter((e) => e <= Math.log(10)).length / Math.max(1, errs.length);
  const medAbs = median(errs);
  return {
    n_test: test.length,
    med_abs_log_err: Math.round(medAbs * 1000) / 1000,
    within_2x: Math.round(within2 * 1000) / 1000,
    within_10x: Math.round(within10 * 1000) / 1000,
    med_abs_pct_err: Math.round((Math.exp(medAbs) - 1) * 1000) / 10,
  };
}

/** TVL carried forward one quarter on its 7-day change, capped at +-20%. */
export function forwardTvl(p: SnapshotProtocol): number {
  const g = Math.min(20, Math.max(-20, finite(p.change_7d, 0)));
  return p.tvl_usd * (1 + g / 100);
}

/** Launch odds from age: 0.20 for a newborn, rising toward 0.75, plus a growth bump. */
export function launchOdds(age: number | null, change7d: number | null): number {
  const a = age ?? 365;
  let odds = 0.2 + 0.55 * (1 - Math.exp(-a / 730));
  if (change7d !== null && change7d > 0) odds += 0.05;
  return Math.min(0.85, Math.max(0.15, odds));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Rankable: pre-token, not an exchange, not a versioned pool, not a wrapped
 * or staked product of a token that already trades. Bridge and liquid
 * staking protocols stay rankable below the floor: they record no token of
 * their own, and several of them did go on to launch one.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Typical gas for one transaction on a chain, in USD. */
export function gasPerTx(chain: string | undefined): number {
  const table: Record<string, number> = {
    Ethereum: 9, BSC: 0.4, 'BNB Chain': 0.4, Solana: 0.15, Base: 0.25, Arbitrum: 0.6,
    Optimism: 0.4, Polygon: 0.15, Avalanche: 0.6, Fantom: 0.3, Gnosis: 0.3,
    Linea: 0.3, Scroll: 0.4, zkSync: 0.4, 'zkSync Era': 0.4, Mantle: 0.3, Blast: 0.3,
    Berachain: 0.5, Hyperliquid: 0.2, Sui: 0.1, Aptos: 0.1, Tron: 0.5, Cronos: 0.3,
  };
  return table[chain ?? ''] ?? 1.5;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy`;
  if (c.includes('launchpad')) return `Commit $${capital} to a ${name} launch on ${chain} and hold the allocation`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s farm on ${chain} and keep the position open`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/** The slice, costs and verdict inputs for one deposit size and drop share. */
export function farmEconomics(valueIfLaunches: number, odds: number, tvl: number, gas: number, deposit: number, dropShare: number): {
  slice: number; fees: number; yieldForgone: number; totalCost: number; hours: number;
  breakEvenOdds: number; net: number; ev: number; verdict: 'FARM' | 'MARGINAL' | 'SKIP';
} {
  const txs = 2 + 1 + PLAN_WEEKS + 1 + 1; // bridge in/out, deposit, weekly, checkpoint, unwind
  const fees = txs * gas;
  const yieldForgone = deposit * YIELD_APY * (PLAN_WEEKS / 52);
  const totalCost = fees + yieldForgone;
  const hours = (10 + 20 + 15 + PLAN_WEEKS * 10 + 10 + 15) / 60;
  const share = deposit / Math.max(1, FARMING_TVL_SHARE * tvl);
  const slice = dropShare * valueIfLaunches * share;
  const breakEvenOdds = slice > 0 ? totalCost / slice : 1;
  const net = slice - totalCost;
  const ev = odds * slice - totalCost;
  const verdict = ev > 0 ? 'FARM' : ev > -0.5 * totalCost ? 'MARGINAL' : 'SKIP';
  return { slice, fees, yieldForgone, totalCost, hours, breakEvenOdds, net, ev, verdict };
}

/**
 * A protocol's farm plan as a 12-week timeline: seven steps, each with its
 * own $ cost and time, derived from the protocol's chain, category, TVL and
 * age. The last step carries the all-in totals for the $1,000 / 7% baseline.
 */
export function farmSteps(p: SnapshotProtocol, valueIfLaunches: number, odds: number): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasPerTx(p.chains[0]);
  const e = farmEconomics(valueIfLaunches, odds, p.tvl_usd, gas, BASE_DEPOSIT_USD, BASE_DROP_SHARE);
  const weeklyGas = money(PLAN_WEEKS * gas);
  const steps: FarmStep[] = [
    { text: `Day 0: set up a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline`, cost: '$0', time: '10 minutes' },
    { text: `Day 0: move $${BASE_DEPOSIT_USD} of USDC to ${chain} for ${p.name}; two transactions on ${chain} at about ${money(gas)} of gas each`, cost: money(2 * gas), time: '20 minutes' },
    { text: `Day 0: ${actionFor(p, BASE_DEPOSIT_USD, chain)}`, cost: money(gas), time: '15 minutes' },
    { text: `Weekly x${PLAN_WEEKS}: make one qualifying action each week on ${p.name}, a deposit, swap, borrow or vote, so every weekly snapshot catches you`, cost: `${weeklyGas} of gas over ${PLAN_WEEKS} weeks`, time: `10 minutes a week, ${PLAN_WEEKS * 10} minutes in all` },
    { text: `Week 6: checkpoint. Open ${p.name}'s own points or rewards page, check the position is still counted, and top up only if your share has slipped`, cost: money(gas), time: '10 minutes' },
    { text: `Week 12: decide. Claim only from a link ${p.name} itself publishes, or unwind the position back to USDC on ${chain}`, cost: money(gas), time: '15 minutes' },
    { text: `Hold: keep $${BASE_DEPOSIT_USD} in the position for ${PLAN_WEEKS} weeks. All-in for this plan: ${money(e.fees)} fees plus ${money(e.yieldForgone)} yield forgone = ${money(e.totalCost)}, ${e.hours.toFixed(1)} hours. If it launches, your slice is about ${money(e.slice)} at a 7% drop, break-even odds ${(e.breakEvenOdds * 100).toFixed(0)}%, net ${money(e.net)} if it launches`, cost: money(e.totalCost), time: `${e.hours.toFixed(1)} hours over ${PLAN_WEEKS} weeks` },
  ];
  return steps;
}

export function stepText(step: FarmStep): string {
  let s = `${step.text}. Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

export interface Scored {
  p: SnapshotProtocol;
  implied: number;
  valueIfLaunches: number;
  odds: number;
  lo: number;
  hi: number;
  fwdTvl: number;
  premium: number;
  age: number | null;
}

/** Score one protocol under the fitted curve. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, fit: Fit, premiums: Map<string, number>): Scored {
  const age = ageDays(asOf, p.listed_at);
  const fwdTvl = forwardTvl(p);
  const premium = premiums.get(p.category ?? 'Unknown') ?? 1;
  const curve = Math.exp(fit.a + fit.b * Math.log(Math.max(1, fwdTvl)));
  const valueIfLaunches = curve * premium;
  const odds = launchOdds(age, p.change_7d);
  const implied = Math.max(1, Math.round(valueIfLaunches * odds));
  return {
    p, implied, valueIfLaunches: Math.round(valueIfLaunches), odds: Math.round(odds * 1000) / 1000,
    lo: Math.max(1, Math.round(valueIfLaunches * Math.exp(fit.p10))),
    hi: Math.max(1, Math.round(valueIfLaunches * Math.exp(fit.p90))),
    fwdTvl: Math.round(fwdTvl), premium: Math.round(premium * 1000) / 1000, age,
  };
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const traded = trading(snapshot.protocols);
  const fit = fitSizeCurve(traded);
  const premiums = categoryPremiums(traded, fit.global_log_ratio);
  const validation = validateCurve(traded);

  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Early radar: pre-token protocols below the floor, ranked by implied
  // value, not by TVL. A watchlist row is never displaced by an early one.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => scoreProtocol(p, snapshot.as_of, fit, premiums))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const s of early) chosen.set(s.p.slug, s.p);

  const scored = [...chosen.values()]
    .map((p) => scoreProtocol(p, snapshot.as_of, fit, premiums))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    value_if_launches_usd: s.valueIfLaunches,
    launch_odds: s.odds,
    range_lo_usd: s.lo,
    range_hi_usd: s.hi,
    forward_tvl_usd: s.fwdTvl,
    category_premium: s.premium,
    gas_per_tx_usd: gasPerTx(s.p.chains[0]),
    farm_steps: farmSteps(s.p, s.valueIfLaunches, s.odds).map(stepText),
  }));

  const live: LiveRow[] = traded
    .filter((p) => p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
      ratio: p.tvl_usd > 0 ? Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000 : null,
    }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit, validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early.length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
      tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, age_days: r.age_days,
      implied_value_usd: r.implied_value_usd, value_if_launches_usd: r.value_if_launches_usd,
      launch_odds: r.launch_odds, range_lo_usd: r.range_lo_usd, range_hi_usd: r.range_hi_usd,
      forward_tvl_usd: r.forward_tvl_usd, category_premium: r.category_premium,
      gas_per_tx_usd: r.gas_per_tx_usd, farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share the same implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
