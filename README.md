# cardano_dex_poc

## The Idea

The white paper is available in [issue 2](https://github.com/mpizenberg/cardano_dex_poc/issues/2).
Below is a summary of the idea.

Current DEXs on cardano are of three kinds:

1. constant product liquidity pool (minswap, sundae, spectrum, ...)
2. simple order book (muesli, genius)
3. complete but complex and expensive (axo)

I believe there is space for a new DEX that has the following characteristics:

- Open source: on-chain and oﬀ-chain code will be open sourced.
- Fast transactions: An order should happen in the next block, within 20s, as long as there is space and your wallet submit it in time.
- Direct market orders: No need for a 2-step process where you first send tokens then get back the swapped ones if a batcher processed your transaction. What you sign is what you get (wysiwyg)!
- Partial limit orders: Limit orders are possible and can be partially filled.
- Sliding orders: trade price evolves with time, such as Dutch auctions
- Atomic composable transactions: Routing between multiple actions, such as swap iBTC/Ada then Ada/iEth happen in a single transaction. This increases the DEX efficiency.
- Scaling: The DEX parallel throughput scales as more participants provide liquidity.
- No sandwich attack: There is no slippage. And nobody can profit from a transaction you are involved in since exact swap prices are fixed when you sign a transaction.
- Fully decentralized: You could submit the transactions yourself.
- Simple low fees
- Automated trading: Grid trading natively supported.
- Fine-grained liquidity providing: You have flexible liquidity provision, more or less concentrated, for advanced strategies
- You keep your staking power
- Futures and options

These are all features that fit perfectly with Cardano's eUTxO model. I already have proofs of concept contracts for most of these. Any of the existing DEXes on Cardano have tradeoffs that make some of these properties impossible. For example batching prevents atomic composability. Axo's dedicated processing network makes it expensive and not as easily composable with other markets, etc.

This will benefit all Cardano users as it will make trades more capital-efficient and have a lower impact on the overall network block space.

Remark: This project has many similarities with the very recent beta-release of [cardano-swaps][cardano-swaps], so I see potential collaborations.

[cardano-swaps]: https://github.com/fallen-icarus/cardano-swaps

## Disclaimer

The validators in this repository are proofs of concept.
As a consequence, they are not written in ways that prevent all known validator exploits, and will be exploited if you use them as-is.
By using them, you agree to do so at your own risk.
They are only public to showcase the key ideas behind them.
