// Launch Radar dashboard. Reads window.RADAR (written by main.ts), renders
// the board, filters, sorts and a per-protocol detail view. No network: every
// byte shown is in data.js. Farm economics mirror lib/model.ts farmEconomics
// exactly, so the page recomputes verdicts from the same primitives the
// board was built on: fees are 17 gas transactions on the protocol's first
// chain, yield forgone is 4% APY over 12 weeks, and a slice is the drop
// share of the value if it launches times the deposit's share of the farming
// TVL (10% of TVL).
(function () {
  'use strict';
  var D = window.RADAR;
  var app = document.getElementById('app');
  if (!D || !app) return;

  var state = { q: '', cat: '', chain: '', verdict: '', sort: 'implied', dir: -1, tab: 'pre', sel: null,
    deposit: 1000, share: 0.07 };
  var params = new URLSearchParams(location.search);
  if (params.get('tab') === 'live') state.tab = 'live';
  if (params.get('verdict')) { state.verdict = params.get('verdict'); }
  if (params.get('detail')) state.sel = params.get('detail');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtMoney(n) { return n >= 100 ? '$' + Math.round(n) : '$' + n.toFixed(2); }
  function fmtPct(n, d) { if (n == null || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(d == null ? 2 : d) + '%'; }
  function fmtAge(days) { if (days == null) return 'unknown'; if (days >= 365) return (days / 365).toFixed(1) + 'y'; return Math.round(days) + 'd'; }
  function fmtOdds(o) { return Math.round(o * 100) + '%'; }
  function fmtShare() { var p = state.share * 100; return (Math.round(p * 10) / 10) + '%'; }

  function econ(r) {
    var txs = 17, fees = txs * r.gas_per_tx_usd;
    var yf = state.deposit * 0.04 * (12 / 52);
    var total = fees + yf;
    var hours = (10 + 20 + 15 + 120 + 10 + 15) / 60;
    var slice = state.share * r.value_if_launches_usd * (state.deposit / Math.max(1, 0.1 * r.tvl_usd));
    var be = slice > 0 ? total / slice : 1;
    var net = slice - total, ev = r.launch_odds * slice - total;
    var verdict = ev > 0 ? 'FARM' : ev > -0.5 * total ? 'MARGINAL' : 'SKIP';
    return { fees: fees, yf: yf, total: total, hours: hours, slice: slice, be: be, net: net, ev: ev, verdict: verdict };
  }

  // ---- header, stats, model ----
  document.getElementById('meta').textContent = 'snapshot ' + D.as_of + '  ·  model ' + D.model_version + '  ·  ' + D.rows.length + ' rows';
  document.getElementById('asof').textContent = D.as_of;
  var f = D.fit, v = D.validation;
  var farmN = D.rows.filter(function (r) { return econ(r).verdict === 'FARM'; }).length;
  document.getElementById('stats').innerHTML =
    stat(fmtUsd(D.rows[0].implied_value_usd), 'top implied value · #' + D.rows[0].rank + ' ' + esc(D.rows[0].name)) +
    stat(D.rows.length + ' rows', D.watchlist_size + ' watchlist + ' + D.early_size + ' early') +
    stat(farmN + ' FARM', 'at $1,000 · 7% drop') +
    stat('b = ' + f.b.toFixed(3), 'size curve, n = ' + f.n + ' trading');
  function stat(b, s) { return '<div class="stat"><b>' + b + '</b><span>' + esc(s) + '</span></div>'; }
  document.getElementById('fitline').innerHTML = 'Fitted on <b>' + f.n + '</b> trading protocols: ' +
    'log(mcap) = ' + f.a.toFixed(2) + ' + ' + f.b.toFixed(3) + ' &middot; log(TVL), residual sd ' + f.resid_sd.toFixed(2) +
    ' in log space. A 10x bigger TVL means about ' + Math.pow(10, f.b).toFixed(1) + 'x the market cap. ' +
    'P10/P90 residual band: ' + f.p10.toFixed(2) + ' / +' + f.p90.toFixed(2) + ' in logs.';
  document.getElementById('validline').innerHTML = '<span class="big">Held out ' + v.n_test + ' tokens the fit never saw: ' +
    'median miss ' + v.med_abs_pct_err + '% (' + v.med_abs_log_err + ' in logs), ' +
    Math.round(v.within_2x * 100) + '% within 2x of the real market cap, ' + Math.round(v.within_10x * 100) + '% within 10x.</span>';

  // ---- filter options ----
  var cats = [], chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  fillSel('cat', cats); fillSel('chain', chains);
  function fillSel(id, vals) {
    var s = document.getElementById(id);
    vals.forEach(function (x) { var o = document.createElement('option'); o.value = x; o.textContent = x; s.appendChild(o); });
  }
  if (state.verdict) document.getElementById('verdict').value = state.verdict;

  // ---- table ----
  var tbody = document.getElementById('rows');
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict && econ(r).verdict !== state.verdict) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'tvl') return r.tvl_usd; if (key === 'odds') return r.launch_odds;
      if (key === 'slice') return econ(r).slice; if (key === 'ev') return econ(r).ev;
      if (key === 'name') return r.name.toLowerCase(); if (key === 'category') return (r.category || '').toLowerCase();
      if (key === 'change') return r.change_7d == null ? -999 : r.change_7d;
      if (key === 'age') return r.age_days == null ? -1 : r.age_days;
      if (key === 'vifl') return r.value_if_launches_usd; if (key === 'rank') return r.rank;
      return r.implied_value_usd;
    };
    rows.sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * dir; });
    return rows;
  }
  function renderTable() {
    var rows = filtered();
    document.getElementById('count').textContent = rows.length + ' of ' + D.rows.length + ' pre-token protocols · deposit $' +
      state.deposit.toLocaleString() + ' · drop share ' + fmtShare() + ' · verdicts recomputed live';
    document.getElementById('tablenote').textContent = state.tab === 'live'
      ? 'Showing the already-trading set below. The board above stays pre-token only.'
      : 'Click a row for the value breakdown, nearest traded comparables, the snapshot record and the costed 12-week farm plan.';
    tbody.innerHTML = rows.map(function (r) {
      var e = econ(r);
      return '<tr class="row' + (state.sel === r.slug ? ' sel' : '') + '" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc((r.chains || []).slice(0, 1).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + fmtUsd(r.value_if_launches_usd) + '</td>' +
        '<td class="num">' + fmtOdds(r.launch_odds) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + fmtUsd(r.range_lo_usd) + '–' + fmtUsd(r.range_hi_usd) + '</td>' +
        '<td><span class="badge ' + e.verdict + '">' + e.verdict + '</span></td></tr>';
    }).join('') || '<tr><td colspan="12">No protocols match these filters.</td></tr>';
    tbody.querySelectorAll('tr.row').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
  }

  // ---- live tab ----
  var liveBody = document.getElementById('liverows');
  liveBody.innerHTML = D.live.map(function (p) {
    return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td><td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
      '<td class="num">' + fmtUsd(p.mcap_usd) + '</td><td class="num">' + (p.ratio == null ? 'n/a' : p.ratio.toFixed(2) + 'x') + '</td>' +
      '<td class="num ' + (p.change_7d > 0 ? 'pos' : p.change_7d < 0 ? 'neg' : '') + '">' + fmtPct(p.change_7d) + '</td></tr>';
  }).join('');

  // ---- detail view ----
  var detail = document.getElementById('detail');
  function select(slug) {
    state.sel = slug;
    var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) { detail.hidden = true; renderTable(); return; }
    var e = econ(r);
    var g = r.change_7d == null ? 0 : Math.min(20, Math.max(-20, r.change_7d));
    // Nearest traded comparables: same category first, closest TVL.
    var comps = D.live.slice().sort(function (a, b) {
      var sa = (a.category === r.category ? 0 : 1) + Math.abs(Math.log(a.tvl_usd) - Math.log(r.tvl_usd)) / 10;
      var sb = (b.category === r.category ? 0 : 1) + Math.abs(Math.log(b.tvl_usd) - Math.log(r.tvl_usd)) / 10;
      return sa - sb;
    }).slice(0, 5);
    var compRows = comps.map(function (c) {
      var curve = Math.exp(D.fit.a + D.fit.b * Math.log(c.tvl_usd));
      return '<tr><td><span class="name">' + esc(c.name) + '</span><br><span class="slug">' + esc(c.slug) + (c.category === r.category ? ' · same category' : '') + '</span></td>' +
        '<td class="num">' + fmtUsd(c.tvl_usd) + '</td><td class="num">' + fmtUsd(curve) + '</td>' +
        '<td class="num">' + fmtUsd(c.mcap_usd) + '</td><td class="num">' + (c.ratio == null ? 'n/a' : c.ratio.toFixed(2) + 'x') + '</td></tr>';
    }).join('');
    var steps = r.farm_steps.map(function (s, i) {
      var when = ['Day 0', 'Day 0', 'Day 0', 'Weekly ×12', 'Week 6', 'Week 12', 'Hold'][i] || '';
      return '<li><span class="when">' + when + '</span><span class="what">' + esc(s) + '</span></li>';
    }).join('');
    detail.innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="badge ' + e.verdict + '">' + e.verdict + '</span></h2>' +
      '<p class="small">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' + esc((r.chains || []).join(', ')) +
      ' · tracked since ' + esc(r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ') · records no token (gecko_id, symbol and market cap all null in the snapshot).</p>' +
      '<div class="kv">' +
      stat(fmtUsd(r.implied_value_usd), 'implied value') + stat(fmtUsd(r.value_if_launches_usd), 'value if launches') +
      stat(fmtOdds(r.launch_odds), 'launch odds') + stat(fmtUsd(r.range_lo_usd) + '–' + fmtUsd(r.range_hi_usd), 'P10–P90 if it launches') +
      stat(fmtMoney(e.slice), 'your slice at $' + state.deposit.toLocaleString() + ' · ' + fmtShare()) +
      stat(fmtMoney(e.net), 'net if it launches') + '</div>' +
      '<h3>How the value is built</h3><div class="breakdown">' +
      'TVL ' + fmtUsd(r.tvl_usd) + '  →  forward TVL ' + fmtUsd(r.forward_tvl_usd) + ' (7d ' + fmtPct(r.change_7d) + ', capped ±20%)<br>' +
      'size curve exp(' + D.fit.a.toFixed(2) + ' + ' + D.fit.b.toFixed(3) + ' · ln(TVL)) = ' + fmtUsd(Math.exp(D.fit.a + D.fit.b * Math.log(Math.max(1, r.forward_tvl_usd)))) + '<br>' +
      '× category premium ' + r.category_premium.toFixed(2) + ' (' + esc(r.category || 'Unknown') + ')  →  value if launches ' + fmtUsd(r.value_if_launches_usd) + '<br>' +
      '× launch odds ' + fmtOdds(r.launch_odds) + ' (age ' + fmtAge(r.age_days) + ')  →  <b>implied value ' + fmtUsd(r.implied_value_usd) + '</b><br>' +
      'P10–P90 band ' + fmtUsd(r.range_lo_usd) + ' – ' + fmtUsd(r.range_hi_usd) + ' from the fit&rsquo;s residuals.</div>' +
      '<h3 style="margin-top:14px">Nearest traded comparables — what the curve says vs what the market paid</h3>' +
      '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Curve says</th><th class="num">Actual mcap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' + compRows + '</tbody></table></div>' +
      '<h3 style="margin-top:14px">Snapshot record</h3>' +
      '<div class="tablewrap"><table><tbody>' +
      '<tr><td>tvl_usd</td><td class="num">' + r.tvl_usd.toLocaleString() + '</td><td>change_7d</td><td class="num">' + fmtPct(r.change_7d) + '</td></tr>' +
      '<tr><td>listed_at</td><td class="num">' + esc(r.listed_at || 'null') + '</td><td>category</td><td class="num">' + esc(r.category || 'null') + '</td></tr>' +
      '<tr><td>mcap_usd</td><td class="num">null</td><td>gecko_id / symbol</td><td class="num">null / null</td></tr>' +
      '</tbody></table></div>' +
      '<h3 id="farmplan" style="margin-top:14px">Farm plan — 12 weeks, costed for $' + state.deposit.toLocaleString() + ' at a ' + fmtShare() + ' drop</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<div class="totals">' +
      stat(fmtMoney(e.fees), 'fees (17 tx × ' + fmtMoney(r.gas_per_tx_usd) + ' gas)') +
      stat(fmtMoney(e.yf), 'yield forgone (4% APY, 12w)') +
      stat(fmtMoney(e.total), 'all-in cost') +
      stat(fmtPct(e.be * 100, 0), 'break-even odds') +
      stat(fmtMoney(e.ev), 'expected value (odds × slice − cost)') +
      stat(fmtMoney(e.net / e.hours) + '/h', 'net per hour if it launches') + '</div>' +
      '<p class="small">Verdict rule: FARM when expected value is positive, MARGINAL when the expected loss is under half the cost, SKIP otherwise. Change the deposit or drop share above and this plan re-prices itself.</p>';
    detail.hidden = false;
    renderTable();
    if (params.get('focus') === 'plan') {
      var fp = document.getElementById('farmplan');
      if (fp) fp.scrollIntoView({ behavior: 'auto', block: 'start' });
    } else {
      detail.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }

  // ---- events ----
  function bind(id, fn) { document.getElementById(id).addEventListener('input', fn); document.getElementById(id).addEventListener('change', fn); }
  bind('q', function (e) { state.q = e.target.value; renderTable(); });
  bind('cat', function (e) { state.cat = e.target.value; renderTable(); });
  bind('chain', function (e) { state.chain = e.target.value; renderTable(); });
  bind('verdict', function (e) { state.verdict = e.target.value; renderTable(); });
  bind('deposit', function (e) { state.deposit = +e.target.value; renderTable(); if (state.sel) select(state.sel); });
  bind('share', function (e) { state.share = +e.target.value; renderTable(); if (state.sel) select(state.sel); });
  bind('sort', function (e) { state.sort = e.target.value; state.dir = -1; renderTable(); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      renderTable();
    });
  });
  function setTab(t) {
    state.tab = t;
    document.getElementById('tabPre').classList.toggle('on', t === 'pre');
    document.getElementById('tabLive').classList.toggle('on', t === 'live');
    document.getElementById('live').hidden = t !== 'live';
    document.getElementById('board').closest('.panel').style.display = t === 'live' ? 'none' : '';
  }
  document.getElementById('tabPre').addEventListener('click', function () { setTab('pre'); });
  document.getElementById('tabLive').addEventListener('click', function () { setTab('live'); });

  renderTable();
  if (state.tab === 'live') setTab('live');
  if (state.sel) select(state.sel);
  window.__shotReady = true;
})();
