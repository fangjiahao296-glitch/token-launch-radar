# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fangjiahao296-glitch/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fangjiahao296-glitch/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot of every protocol, finds the protocols that record no token and are not wrapped, staked or bridged products of a token that already trades, prices each by the market-cap-per-TVL of its live-token peers in the same category, and serves a dashboard with the ranked board, a per-protocol model breakdown and farm plan, and the live-token set the benchmarks come from. The snapshot is the grader's sealed input; it is not in this repository.

## Run it

```sh
node main.ts --input snapshot.json --output out
```

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
