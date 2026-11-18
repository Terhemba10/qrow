// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {PqAuth} from "./PqAuth.sol";

interface IERC20Perp {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title  QrowPerps: testnet perpetual futures with fUSD margin, post-quantum protected
/// @notice Long or short a pair (ETH/USDT, SOL/USDT, BNB/USDT, QOR/USDT, QOR/ETH, QOR/SOL) with 1x to 100x leverage.
///         Prices come from signed price reports: Qrow's price service reads public market data (Binance) and the
///         QoreChain testnet QOR/fUSD pool, and signs (pair, price, time) with PRICE_SIGNER's key; this contract
///         accepts a report at most 2 minutes old. No server sends transactions.
///         The counterparty is this contract's pool (seeded by the deployer): profits are paid from it, losses go
///         to it. A position is liquidated (by anyone, who earns a small reward) when its loss reaches the margin
///         minus a 0.5% maintenance margin. Open, close and the trader's limits need the trader's ML-DSA-87
///         signature. Testnet only: fUSD has no value.
contract QrowPerps is ReentrancyGuard, PqAuth {
    bytes32 public constant ACTION_OPEN = keccak256("PERP_OPEN");
    bytes32 public constant ACTION_CLOSE = keccak256("PERP_CLOSE");
    bytes32 public constant ACTION_TPSL = keccak256("PERP_TPSL");
    bytes32 public constant PRICE_TAG = keccak256("QROW_PRICE_V1");

    uint256 public constant MAX_LEVERAGE = 100;
    uint256 public constant FEE_BPS = 5; // 0.05% of size on open and on close
    uint256 public constant MAINT_BPS = 50; // 0.5% of size
    uint256 public constant LIQ_REWARD_BPS = 500; // 5% of the remaining margin to the liquidator
    uint256 public constant MIN_MARGIN = 1e6; // 1 fUSD
    uint256 public constant MAX_MARGIN = 10_000e6; // 10,000 fUSD per position
    uint64 public constant MAX_REPORT_AGE = 2 minutes;
    uint256 public constant PRICE_DECIMALS = 8;

    struct Position {
        address trader;
        bytes32 pair;
        bool isLong;
        bool open;
        uint8 closedBy; // 0 open, 1 trader, 2 liquidation, 3 take profit, 4 stop loss
        uint64 openedAt;
        uint64 closedAt;
        uint256 margin; // fUSD units
        uint256 size; // margin * leverage, fUSD units
        uint256 entryPrice; // 1e8
        uint256 exitPrice; // 1e8
        int256 pnl; // fUSD units, after fees
    }

    /// @notice An order: tp / sl are trigger prices (1e8), 0 = none. Long: tp above entry, sl below; short: the reverse.
    struct OpenOrder {
        bytes32 pair;
        bool isLong;
        uint256 margin;
        uint256 leverage;
        uint256 acceptablePrice;
        uint256 takeProfit;
        uint256 stopLoss;
    }

    struct TpSl {
        uint256 takeProfit;
        uint256 stopLoss;
    }

    struct PriceReport {
        bytes32 pair;
        uint256 price;
        uint64 timestamp;
        bytes signature;
    }

    IERC20Perp public immutable fusd;
    address public owner;
    address public priceSigner;
    mapping(bytes32 => bool) public pairEnabled;

    uint256 public positionCount;
    mapping(uint256 => Position) private _positions;
    mapping(address => uint256[]) private _byTrader;
    mapping(uint256 => TpSl) private _tpSl;
    /// @notice fUSD reserved to pay out open positions' margins (not available as pool profit).
    uint256 public lockedMargin;
    uint256 public openInterest;

    event PairSet(bytes32 indexed pair, bool enabled);
    event SignerSet(address indexed signer);
    event Opened(uint256 indexed id, address indexed trader, bytes32 indexed pair, bool isLong, uint256 margin, uint256 size, uint256 price);
    event Closed(uint256 indexed id, address indexed trader, uint256 price, int256 pnl, uint256 paid, bool liquidated, address by);
    event PoolFunded(address indexed from, uint256 amount);
    event TpSlSet(uint256 indexed id, uint256 takeProfit, uint256 stopLoss);

    error NotOwner();
    error PairOff();
    error BadLeverage();
    error BadMargin();
    error StaleReport();
    error BadReport();
    error PriceLimit();
    error NotTrader();
    error NotOpen();
    error NotLiquidatable();
    error PaymentFailed();
    error PoolTooSmall();
    error BadTpSl();
    error NotTriggered();

    constructor(address fusd_, address priceSigner_, string memory nativeChainId_, address keys_)
        PqAuth(keccak256("QROW_PERPS_V1"), nativeChainId_, keys_)
    {
        fusd = IERC20Perp(fusd_);
        owner = msg.sender;
        priceSigner = priceSigner_;
        emit SignerSet(priceSigner_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ================================================================== admin (no access to traders' money)

    function setPair(bytes32 pair, bool enabled) external onlyOwner {
        pairEnabled[pair] = enabled;
        emit PairSet(pair, enabled);
    }

    function setPriceSigner(address s) external onlyOwner {
        priceSigner = s;
        emit SignerSet(s);
    }

    /// @notice Anyone may add fUSD to the pool (it backs traders' profits). Nobody can withdraw it.
    function fundPool(uint256 amount) external nonReentrant {
        _pull(msg.sender, amount);
        emit PoolFunded(msg.sender, amount);
    }

    // ================================================================== trading

    /// @notice Open a position. `o.acceptablePrice`: for a long the highest entry accepted, for a short the lowest (1e8).
    ///         Optional take profit / stop loss are set in the same signed call.
    function open(OpenOrder calldata o, PriceReport calldata report, uint64 validUntil, bytes calldata pqSig) external nonReentrant returns (uint256 id) {
        if (!pairEnabled[o.pair]) revert PairOff();
        if (o.leverage == 0 || o.leverage > MAX_LEVERAGE) revert BadLeverage();
        if (o.margin < MIN_MARGIN || o.margin > MAX_MARGIN) revert BadMargin();
        _requirePq(msg.sender, ACTION_OPEN, keccak256(abi.encode(o)), validUntil, pqSig);
        uint256 price = _price(o.pair, report);
        if (o.isLong ? price > o.acceptablePrice : price < o.acceptablePrice) revert PriceLimit();
        _checkTpSl(o.isLong, price, o.takeProfit, o.stopLoss);
        id = _openAt(o.pair, o.isLong, o.margin, o.margin * o.leverage, price);
        if (o.takeProfit != 0 || o.stopLoss != 0) {
            _tpSl[id] = TpSl(o.takeProfit, o.stopLoss);
            emit TpSlSet(id, o.takeProfit, o.stopLoss);
        }
    }

    /// @notice Change (or clear with 0) the take profit and stop loss of the caller's open position.
    function setTpSl(uint256 id, uint256 takeProfit, uint256 stopLoss, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        Position storage p = _positions[id];
        if (!p.open) revert NotOpen();
        if (p.trader != msg.sender) revert NotTrader();
        _requirePq(msg.sender, ACTION_TPSL, keccak256(abi.encode(id, takeProfit, stopLoss)), validUntil, pqSig);
        _checkTpSl(p.isLong, p.entryPrice, takeProfit, stopLoss);
        _tpSl[id] = TpSl(takeProfit, stopLoss);
        emit TpSlSet(id, takeProfit, stopLoss);
    }

    /// @notice Anyone can close a position whose take profit or stop loss the price has reached. The trader gets
    ///         exactly what a close at this signed price would pay; the caller earns nothing.
    function executeTpSl(uint256 id, PriceReport calldata report) external nonReentrant returns (uint256 paid) {
        Position storage p = _positions[id];
        if (!p.open) revert NotOpen();
        uint256 price = _price(p.pair, report);
        uint8 reason = _tpSlHit(p.isLong, _tpSl[id], price);
        if (reason == 0) revert NotTriggered();
        paid = _settle(id, p, price, reason);
    }

    function _openAt(bytes32 pair, bool isLong, uint256 margin, uint256 size, uint256 price) private returns (uint256 id) {
        uint256 fee = (size * FEE_BPS) / 10_000;
        if (fee >= margin) revert BadMargin();
        // Payouts are capped by the pool, so this only stops trading against an empty pool.
        if (poolBalance() < margin) revert PoolTooSmall();
        _pull(msg.sender, margin);
        uint256 net = margin - fee; // the fee stays in the pool
        id = ++positionCount;
        _positions[id] = Position(msg.sender, pair, isLong, true, 0, uint64(block.timestamp), 0, net, size, price, 0, 0);
        _byTrader[msg.sender].push(id);
        lockedMargin += net;
        openInterest += size;
        emit Opened(id, msg.sender, pair, isLong, net, size, price);
    }

    /// @param acceptablePrice for a long, the lowest exit price accepted; for a short, the highest (1e8).
    function close(uint256 id, uint256 acceptablePrice, PriceReport calldata report, uint64 validUntil, bytes calldata pqSig)
        external
        nonReentrant
        returns (uint256 paid)
    {
        Position storage p = _positions[id];
        if (!p.open) revert NotOpen();
        if (p.trader != msg.sender) revert NotTrader();
        _requirePq(msg.sender, ACTION_CLOSE, keccak256(abi.encode(id, acceptablePrice)), validUntil, pqSig);
        uint256 price = _price(p.pair, report);
        if (p.isLong ? price < acceptablePrice : price > acceptablePrice) revert PriceLimit();
        paid = _settle(id, p, price, 1);
    }

    /// @notice Anyone can liquidate a position whose equity fell to the maintenance margin; they earn 5% of what's left.
    function liquidate(uint256 id, PriceReport calldata report) external nonReentrant {
        Position storage p = _positions[id];
        if (!p.open) revert NotOpen();
        uint256 price = _price(p.pair, report);
        if (!_liquidatable(p, price)) revert NotLiquidatable();
        _settle(id, p, price, 2);
    }

    // ================================================================== views

    function getPosition(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    function getTpSl(uint256 id) external view returns (TpSl memory) {
        return _tpSl[id];
    }

    /// @notice 0 = not triggered, 3 = take profit, 4 = stop loss, at `price`.
    function tpSlTriggered(uint256 id, uint256 price) external view returns (uint8) {
        Position storage p = _positions[id];
        return p.open ? _tpSlHit(p.isLong, _tpSl[id], price) : 0;
    }

    function positionsOf(address trader) external view returns (uint256[] memory) {
        return _byTrader[trader];
    }

    /// @notice fUSD in the pool that isn't traders' margin.
    function poolBalance() public view returns (uint256) {
        uint256 bal = fusd.balanceOf(address(this));
        return bal > lockedMargin ? bal - lockedMargin : 0;
    }

    /// @notice PnL before the closing fee, in fUSD units, at `price`.
    function pnlAt(uint256 id, uint256 price) public view returns (int256) {
        Position storage p = _positions[id];
        int256 move = int256(price) - int256(p.entryPrice);
        int256 raw = (int256(p.size) * move) / int256(p.entryPrice);
        return p.isLong ? raw : -raw;
    }

    /// @notice The price at which the position can be liquidated (1e8).
    function liquidationPrice(uint256 id) external view returns (uint256) {
        Position storage p = _positions[id];
        uint256 maint = (p.size * MAINT_BPS) / 10_000;
        if (p.margin <= maint) return p.entryPrice;
        uint256 room = ((p.margin - maint) * p.entryPrice) / p.size; // price move that eats the margin
        return p.isLong ? (room >= p.entryPrice ? 0 : p.entryPrice - room) : p.entryPrice + room;
    }

    /// @notice The digest a price report signs (EIP-191 signed message of this hash).
    function reportHash(bytes32 pair, uint256 price, uint64 timestamp) public view returns (bytes32) {
        return keccak256(abi.encode(PRICE_TAG, block.chainid, address(this), pair, price, timestamp));
    }

    // ================================================================== internals

    function _liquidatable(Position storage p, uint256 price) private view returns (bool) {
        int256 pnl;
        {
            int256 move = int256(price) - int256(p.entryPrice);
            int256 raw = (int256(p.size) * move) / int256(p.entryPrice);
            pnl = p.isLong ? raw : -raw;
        }
        int256 equity = int256(p.margin) + pnl;
        return equity <= int256((p.size * MAINT_BPS) / 10_000);
    }

    function _checkTpSl(bool isLong, uint256 entry, uint256 tp, uint256 sl) private pure {
        if (isLong ? (tp != 0 && tp <= entry) || (sl != 0 && sl >= entry) : (tp != 0 && tp >= entry) || (sl != 0 && sl <= entry)) revert BadTpSl();
    }

    function _tpSlHit(bool isLong, TpSl storage t, uint256 price) private view returns (uint8) {
        if (isLong) {
            if (t.takeProfit != 0 && price >= t.takeProfit) return 3;
            if (t.stopLoss != 0 && price <= t.stopLoss) return 4;
        } else {
            if (t.takeProfit != 0 && price <= t.takeProfit) return 3;
            if (t.stopLoss != 0 && price >= t.stopLoss) return 4;
        }
        return 0;
    }

    function _settle(uint256 id, Position storage p, uint256 price, uint8 reason) private returns (uint256 paid) {
        bool liquidation = reason == 2;
        int256 pnl = pnlAt(id, price);
        uint256 fee = (p.size * FEE_BPS) / 10_000;
        int256 equity = int256(p.margin) + pnl - int256(fee);
        lockedMargin -= p.margin;
        openInterest -= p.size;
        p.open = false;
        p.closedAt = uint64(block.timestamp);
        p.exitPrice = price;
        p.closedBy = reason;

        uint256 toTrader;
        uint256 toLiquidator;
        if (liquidation) {
            uint256 left = equity > 0 ? uint256(equity) : 0;
            toLiquidator = (left * LIQ_REWARD_BPS) / 10_000;
            // The trader keeps nothing after a liquidation; the rest stays in the pool.
        } else if (equity > 0) {
            toTrader = uint256(equity);
            uint256 cap = poolBalance(); // margin already unlocked above: never pay more than the contract holds freely
            if (toTrader > cap) toTrader = cap;
        }
        p.pnl = int256(toTrader) - int256(p.margin + (p.size * FEE_BPS) / 10_000);
        paid = toTrader;
        emit Closed(id, p.trader, price, p.pnl, toTrader, liquidation, msg.sender);
        if (toTrader > 0) _push(p.trader, toTrader);
        if (toLiquidator > 0) _push(msg.sender, toLiquidator);
    }

    function _price(bytes32 pair, PriceReport calldata r) private view returns (uint256) {
        if (r.pair != pair || r.price == 0) revert BadReport();
        if (r.timestamp > block.timestamp + 30 || block.timestamp > r.timestamp + MAX_REPORT_AGE) revert StaleReport();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(reportHash(pair, r.price, r.timestamp));
        (address who, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, r.signature);
        if (err != ECDSA.RecoverError.NoError || who != priceSigner) revert BadReport();
        return r.price;
    }

    function _pull(address from, uint256 amount) private {
        uint256 before = fusd.balanceOf(address(this));
        (bool ok, bytes memory ret) = address(fusd).call(abi.encodeCall(IERC20Perp.transferFrom, (from, address(this), amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PaymentFailed();
        if (fusd.balanceOf(address(this)) - before != amount) revert PaymentFailed();
    }

    function _push(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = address(fusd).call(abi.encodeCall(IERC20Perp.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PaymentFailed();
    }
}
