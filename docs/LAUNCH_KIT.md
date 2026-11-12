# Launch kit (texts for the owner to post; Claude posts nothing)

## QoreChain Discord: public endpoint limits

> Hi QoreChain team! I'm building **Qrow** for Build Before Q-Day (Post-Quantum dApp category): escrow payments where
> every step is ML-DSA-87 protected. We're opening a public testnet beta and expect up to about 15,000 users over the
> fest, with peaks of 1,000 to 2,000 at once (around People's Choice).
>
> Two questions so we don't overload anything:
> 1. Do `api-testnet.qore.host`, `evm-testnet.qore.host` and `evm-ws-testnet.qore.host` have rate limits we should stay
>    under (per IP, per second)? We cache reads server-side and slow down polling, but browsers still call the EVM RPC
>    directly.
> 2. If it would help, is there a dedicated testnet endpoint for fest projects with heavier traffic?
>
> Also a finding: `MsgCrossVMCall` from a native account to an EVM contract works on testnet (verified 13 Nov), but the
> chain rejects an empty `source_vm` even though the docs say it's ignored. Happy to share details. Thanks!

More launch texts (X post, Telegram message, 30-second recording, How to test guide) follow once the live URL exists.
