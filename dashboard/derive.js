// The radar's shared derivation: the value model and the farm plans, as pure functions of the
// snapshot's own figures. main.ts (Node) and the dashboard page (browser) both run this one file,
// so the board's numbers and the page's numbers are the same arithmetic, never two copies of it.
//
// Value model (comps-based, no protocol name is ever special-cased):
//   multiple   = the category's median market-cap-per-TVL among the snapshot's live-token
//                protocols, when at least MIN_COMPS of them record both figures; else the
//                global median across every live-token protocol. Clamped to a sane band.
//   implied    = tvl_usd x multiple x growth multiplier x maturity multiplier
//   growth     = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (unknown age counts as 365 days)
// The multiple is what the market already pays for a dollar of TVL in the same line of business.
// A pre-token protocol is priced as if the market priced it the way it prices its live peers.
//
// Farm plans are derived from the protocol's own record only: its category picks the actions, its
// first chain picks the gas tier, its TVL picks the capital, its age picks the hold. Gas figures
// are planning estimates by chain tier, labelled as such on the page; nothing here claims a
// points program exists, because the snapshot records none.

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RADAR_DERIVE = api;
})(globalThis, function () {
  'use strict';

  /** The model's constants, stated on the dashboard's model panel. */
  var MODEL = {
    growth_weight: 0.5,
    growth_floor: -60,
    growth_cap: 120,
    maturity_floor: 0.6,
    maturity_range: 0.4,
    maturity_days: 1095,
    unknown_age_days: 365,
    multiple_min: 0.05,
    multiple_max: 2.5,
    min_comps: 3,
  };

  var MODEL_VERSION = 'radar-2';

  var DAY_MS = 86400000;

  /** A finite number, else `fallback`. */
  function finite(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  /** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
  function ageDays(asOf, listedAt) {
    if (listedAt === null || listedAt === undefined) return null;
    var a = Date.parse(asOf + 'T00:00:00Z');
    var b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY_MS));
  }

  /** The median of a non-empty array of numbers; null when empty. */
  function median(values) {
    if (values.length === 0) return null;
    var sorted = values.slice().sort(function (x, y) { return x - y; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function clampMultiple(x) {
    return Math.min(MODEL.multiple_max, Math.max(MODEL.multiple_min, x));
  }

  /**
   * The valuation benchmarks, computed from the snapshot's live-token protocols alone: for each
   * category with at least MIN_COMPS protocols recording both a market cap and a TVL, the median
   * market-cap-per-TVL; plus the global median across every such protocol. A category with too
   * few live comps falls back to the global median, and the row says so.
   */
  function benchmarksOf(protocols) {
    var byCategory = {};
    var all = [];
    var i, p, ratio, cat;
    for (i = 0; i < protocols.length; i++) {
      p = protocols[i];
      if (p.mcap_usd === null || p.mcap_usd === undefined) continue;
      if (!(p.mcap_usd > 0) || !(p.tvl_usd > 0)) continue;
      ratio = p.mcap_usd / p.tvl_usd;
      all.push(ratio);
      cat = p.category;
      if (typeof cat === 'string' && cat.length > 0) {
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(ratio);
      }
    }
    var globalMedian = median(all);
    var global = globalMedian === null ? 0.25 : clampMultiple(globalMedian);
    var table = {};
    var names = Object.keys(byCategory).sort();
    for (i = 0; i < names.length; i++) {
      cat = names[i];
      var ratios = byCategory[cat];
      if (ratios.length >= MODEL.min_comps) {
        table[cat] = { multiple: clampMultiple(median(ratios)), comps: ratios.length };
      }
    }
    return { global: global, global_comps: all.length, by_category: table };
  }

  /** The multiple one protocol is priced at: its category's benchmark, or the global one. */
  function multipleFor(category, benchmarks) {
    if (typeof category === 'string' && benchmarks.by_category[category]) {
      return { multiple: benchmarks.by_category[category].multiple, source: 'category', comps: benchmarks.by_category[category].comps };
    }
    return { multiple: benchmarks.global, source: 'global', comps: benchmarks.global_comps };
  }

  /**
   * One protocol's implied value under the model. `figures` carries the snapshot figures the
   * model reads: tvl_usd, change_7d (nullable), age_days (nullable) and category (nullable).
   */
  function impliedOf(figures, benchmarks) {
    var priced = multipleFor(figures.category, benchmarks);
    var growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, finite(figures.change_7d, 0)));
    var growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
    var age = figures.age_days === null || figures.age_days === undefined ? MODEL.unknown_age_days : figures.age_days;
    var maturityMult = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var implied = Math.max(1, Math.round(figures.tvl_usd * priced.multiple * growthMult * maturityMult));
    return {
      implied: implied,
      multiple: priced.multiple,
      multiple_source: priced.source,
      multiple_comps: priced.comps,
      growth_pct: growthPct,
      growth_multiplier: growthMult,
      maturity_multiplier: maturityMult,
      age_days: figures.age_days === null || figures.age_days === undefined ? null : figures.age_days,
    };
  }

  // --------------------------------------------------------------- farm plans

  /** The protocol's first chain, or a neutral phrase when the snapshot names none. */
  function chainOf(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  /** The gas tier of a chain name: planning estimates, applied by name pattern, never by protocol. */
  function gasTier(chain) {
    var c = String(chain).toLowerCase();
    if (c.indexOf('ethereum') >= 0) return { key: 'eth', per_tx: 'about $3-$8', setup: 'about $10-$20', weekly: 'about $3-$8' };
    if (c.indexOf('solana') >= 0) return { key: 'sol', per_tx: 'under $0.05', setup: 'under $0.25', weekly: 'under $0.05' };
    if (/(arbitrum|optimism|base|zksync|zkevm|scroll|linea|mantle|mode|blast|starknet|nova|op\b)/.test(c)) {
      return { key: 'l2', per_tx: 'under $1', setup: 'about $2-$4', weekly: 'under $1' };
    }
    return { key: 'alt', per_tx: 'under $1', setup: 'about $2-$5', weekly: 'under $1' };
  }

  /** The capital one farm position needs, from the protocol's own TVL. */
  function capitalFor(p) {
    if (p.tvl_usd >= 5000000000) return 250;
    if (p.tvl_usd >= 1000000000) return 150;
    if (p.tvl_usd >= 100000000) return 100;
    return 50;
  }

  /** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  /** The category's main action, in words a farmer can follow. */
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('credit') >= 0) {
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the supply position open.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0) {
      return 'Provide $' + capital + ' of liquidity to ' + name + "'s largest pool on " + chain + ' and keep the position open.';
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ' and use the bridged funds in its app.';
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    }
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    }
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Fund $' + capital + ' on ' + name + ' and place positions on two different markets.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    }
    if (c.indexOf('rwa') >= 0) {
      return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    }
    if (c.indexOf('privacy') >= 0) {
      return 'Deposit $' + capital + ' into ' + name + "'s privacy pool on " + chain + ' and make one private transfer.';
    }
    if (c.indexOf('gaming') >= 0 || c.indexOf('nft') >= 0) {
      return 'Spend $' + capital + ' inside ' + name + ' on ' + chain + ' on the assets its game or marketplace needs.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  /** The category's second action: a different interaction, so the activity is not one transaction. */
  function followFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('credit') >= 0) {
      return 'Borrow a small amount, under a third of your supply, against the position and repay it within a week, keeping the health factor high.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0) {
      return 'Swap a small amount, about $10, through ' + name + "'s router on " + chain + ' so the wallet shows trading volume as well as liquidity.';
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Bridge a second, smaller amount back or onward through ' + name + ' a few days later, so the wallet shows repeat use.';
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return 'Use the receipt token once in a lending or liquidity pool on ' + chain + ', or hold it if no pool takes it.';
    }
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) {
      return 'Close the hedge and open a second small one a few days later, keeping total margin near $' + capital + '.';
    }
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Add a second, smaller deposit to another ' + name + ' vault on ' + chain + ' a few days later.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Settle or close one position and open a new one on a different market the next week.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Provide the stable asset as liquidity in one pool on ' + chain + ' for at least a week.';
    }
    if (c.indexOf('rwa') >= 0) {
      return 'Check the first distribution or yield payment, and keep the asset through it.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Read the cover terms and note the expiry, so the policy is renewed before it lapses.';
    }
    if (c.indexOf('privacy') >= 0) {
      return 'Withdraw a small amount back to a fresh address to complete one full private round trip.';
    }
    if (c.indexOf('gaming') >= 0 || c.indexOf('nft') >= 0) {
      return 'List or use one asset a second time a few days later, so the wallet shows repeat activity.';
    }
    return 'Repeat the deposit with a second, smaller amount a few days later, so the wallet shows repeat use.';
  }

  /** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\u2019s own page.';
    return s;
  }

  /**
   * A protocol's farm plan: seven steps, each an action with a cost and a time. Derived from the
   * protocol's own record (category, chains, TVL, age) and the chain's gas tier, never from a
   * hand-written list of names. Costs are planning estimates; the snapshot records no points
   * program, so no step promises one.
   */
  function farmSteps(p, age) {
    var chain = chainOf(p);
    var gas = gasTier(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(age);
    return [
      {
        text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
        cost: gas.per_tx + ' of gas for the first transaction (estimate)',
        time: '5 minutes',
      },
      {
        text: actionFor(p, capital, chain),
        cost: '$' + capital + ' of capital and ' + gas.setup + ' of gas (estimate)',
        time: '15 minutes to set up',
      },
      {
        text: followFor(p, capital, chain),
        cost: gas.per_tx + ' of gas (estimate)',
        time: '10 minutes',
      },
      {
        text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
        cost: gas.weekly + ' of gas a week (estimate)',
        time: '10 minutes a week',
      },
      {
        text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
        cost: 'the $' + capital + ' stays in the position',
        time: hold + ' days',
      },
      {
        text: 'Before you withdraw, open the protocol\u2019s own points or rewards page and claim only from the link it publishes; never pay anyone to claim.',
        cost: 'no fee to check',
        time: '10 minutes',
      },
      {
        text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
        cost: 'nothing but the log',
        time: '5 minutes',
      },
    ].map(stepText);
  }

  return {
    MODEL: MODEL,
    MODEL_VERSION: MODEL_VERSION,
    ageDays: ageDays,
    median: median,
    benchmarksOf: benchmarksOf,
    multipleFor: multipleFor,
    impliedOf: impliedOf,
    chainOf: chainOf,
    gasTier: gasTier,
    capitalFor: capitalFor,
    holdDaysFor: holdDaysFor,
    farmSteps: farmSteps,
    stepText: stepText,
  };
});
