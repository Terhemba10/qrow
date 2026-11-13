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
> Also some findings from building on `MsgCrossVMCall` (native account to EVM contract, verified 13 Nov):
> - It works well: our whole app signs through QoreX this way, with no MetaMask and no EVM window.
> - The chain rejects an empty `source_vm` although the docs say it's ignored (we send `cosmwasm`).
> - EVM events emitted during a cross-VM call don't show up in `eth_getLogs` (state changes do), so dApps
>   can't index them. Example: tx `CCBF0062112DD462B6791717734D534B7353679120E3B9DED8F524CB207440EA`, block 9978354,
>   escrow `0x332937d1918a0f85eacc5167ab87ba91c48a4655`. Is that expected, or planned?
> - `eth_getLogs` is capped at 10,000 blocks per request on the public RPC (fine, just worth documenting).
> Happy to share details. Thanks!

More launch texts (X post, Telegram message, 30-second recording, How to test guide) follow once the live URL exists.

## QoreChain Discord: QoreX can't display cross-VM calls or token conversion

> Hi QoreChain team! Building Qrow (Post-Quantum dApp category) on testnet, we want every action signed in QoreX.
> QoreX's `signAndBroadcast` works great for native messages (an AMM swap signed fine), but it refuses two message
> types our dApp needs:
>
> - `/qorechain.crossvm.v1.MsgCrossVMCall`: "QoreX cannot show what /qorechain.crossvm.v1.MsgCrossVMCall does, so
>   it will not sign it"
> - `/cosmos.evm.erc20.v1.MsgConvertCoin`: same message
>
> Both work on testnet when signed with the SDK's hybrid signer (we tested from script accounts), so it's only the
> wallet display. Cross-VM calls would let QoreX users use EVM dApps with no MetaMask and no EVM window, and
> `MsgConvertCoin` is the only way to use faucet fUSD/fETH/fBTC in EVM contracts.
>
> Is support for displaying these planned, and roughly when? Until then we're using authz + a short EVM window
> opened in QoreX. Happy to share test transactions. Thanks!
