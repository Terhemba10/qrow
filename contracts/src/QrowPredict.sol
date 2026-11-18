// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PqAuth} from "./PqAuth.sol";

interface IERC20P {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title  QrowPredict: YES/NO prediction markets on QoreChain testnet, post-quantum protected
/// @notice Each market is a constant-product pool of YES and NO shares backed 1:1 by fUSD (a "complete set"
///         of one YES + one NO is always worth exactly 1 fUSD unit). Buying YES with x fUSD mints x complete
///         sets into the pool and takes YES out so that yes * no stays constant: the YES price
///         (no / (yes + no)) rises as people buy it. Selling is the exact inverse.
///         After the end time a resolver sets the outcome. Winning shares redeem 1 fUSD each, Invalid
///         redeems 0.5 per share of either side; claims open after a 1-hour dispute delay, during which the
///         resolver may correct a mistake. Buys, sells and claims need the trader's ML-DSA-87 signature.
///         Testnet only: fUSD has no value.
contract QrowPredict is ReentrancyGuard, PqAuth {
    bytes32 public constant ACTION_BUY = keccak256("PREDICT_BUY");
    bytes32 public constant ACTION_SELL = keccak256("PREDICT_SELL");
    bytes32 public constant ACTION_CLAIM = keccak256("PREDICT_CLAIM");

    uint256 public constant FEE_BPS = 100; // 1%, to the market's liquidity
    uint64 public constant DISPUTE_DELAY = 1 hours;
    uint256 public constant MIN_TRADE = 10_000; // 0.01 fUSD (6 decimals)

    enum Status {
        Open,
        Resolved
    }

    enum Outcome {
        None,
        Yes,
        No,
        Invalid
    }

    struct Market {
        string question;
        string category;
        uint64 endTime;
        uint64 resolvedAt;
        Status status;
        Outcome outcome;
        uint256 yesPool;
        uint256 noPool;
        uint256 collateral; // fUSD held for this market (sets outstanding + fees)
        uint256 fees;
        uint256 volume;
        uint256 liquidity; // seeded by the creator
        address creator;
        bool lpWithdrawn;
    }

    IERC20P public immutable fusd;
    address public owner;
    mapping(address => bool) public isResolver;

    uint256 public marketCount;
    mapping(uint256 => Market) private _markets;
    /// @notice shares[marketId][trader] = [yes, no]
    mapping(uint256 => mapping(address => uint256[2])) private _shares;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event MarketCreated(uint256 indexed id, string question, string category, uint64 endTime, uint256 liquidity);
    event Traded(uint256 indexed id, address indexed trader, bool yes, bool buy, uint256 collateral, uint256 shares, uint256 yesPriceE6);
    event Resolved(uint256 indexed id, Outcome outcome, address resolver);
    event Claimed(uint256 indexed id, address indexed trader, uint256 payout);
    event ResolverSet(address indexed who, bool allowed);
    event OwnerChanged(address indexed owner);

    error NotOwner();
    error NotResolver();
    error BadMarket();
    error MarketClosed();
    error NotEnded();
    error AlreadyFinal();
    error NotResolved();
    error DisputeWindow();
    error TooSmall();
    error Slippage();
    error NotEnoughShares();
    error NothingToClaim();
    error PaymentFailed();
    error BadOutcome();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address fusd_, string memory nativeChainId_, address keys_)
        PqAuth(keccak256("QROW_PREDICT_V1"), nativeChainId_, keys_)
    {
        fusd = IERC20P(fusd_);
        owner = msg.sender;
        isResolver[msg.sender] = true;
        emit ResolverSet(msg.sender, true);
    }

    // ================================================================== admin

    function setOwner(address next) external onlyOwner {
        owner = next;
        emit OwnerChanged(next);
    }

    function setResolver(address who, bool allowed) external onlyOwner {
        isResolver[who] = allowed;
        emit ResolverSet(who, allowed);
    }

    /// @notice A resolver creates a market and seeds it with `liquidity` fUSD (50/50 to start).
    function createMarket(string calldata question, string calldata category, uint64 endTime, uint256 liquidity)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (!isResolver[msg.sender]) revert NotResolver();
        if (bytes(question).length == 0 || bytes(question).length > 200 || bytes(category).length > 32) revert BadMarket();
        if (endTime <= block.timestamp || liquidity < 1e6) revert BadMarket();
        _pull(msg.sender, liquidity);
        id = ++marketCount;
        Market storage m = _markets[id];
        m.question = question;
        m.category = category;
        m.endTime = endTime;
        m.yesPool = liquidity;
        m.noPool = liquidity;
        m.collateral = liquidity;
        m.liquidity = liquidity;
        m.creator = msg.sender;
        emit MarketCreated(id, question, category, endTime, liquidity);
    }

    /// @notice Set (or, during the dispute delay, correct) the outcome. Only after the end time.
    function resolve(uint256 id, Outcome outcome) external {
        if (!isResolver[msg.sender]) revert NotResolver();
        Market storage m = _market(id);
        if (outcome == Outcome.None) revert BadOutcome();
        if (block.timestamp < m.endTime) revert NotEnded();
        if (m.status == Status.Resolved && block.timestamp >= m.resolvedAt + DISPUTE_DELAY) revert AlreadyFinal();
        m.status = Status.Resolved;
        m.outcome = outcome;
        m.resolvedAt = uint64(block.timestamp);
        emit Resolved(id, outcome, msg.sender);
    }

    // ================================================================== trading

    /// @notice Buy YES (`yes` = true) or NO shares with `amount` fUSD; at least `minShares` or nothing happens.
    function buy(uint256 id, bool yes, uint256 amount, uint256 minShares, uint64 validUntil, bytes calldata pqSig)
        external
        nonReentrant
        returns (uint256 shares)
    {
        Market storage m = _market(id);
        if (m.status != Status.Open || block.timestamp >= m.endTime) revert MarketClosed();
        if (amount < MIN_TRADE) revert TooSmall();
        _requirePq(msg.sender, ACTION_BUY, keccak256(abi.encode(id, yes, amount, minShares)), validUntil, pqSig);

        shares = quoteBuy(id, yes, amount);
        if (shares < minShares || shares == 0) revert Slippage();
        _applyBuy(m, yes, amount);
        _shares[id][msg.sender][yes ? 0 : 1] += shares;
        _pull(msg.sender, amount);
        _traded(id, yes, true, amount, shares);
    }

    /// @notice Sell `shares` YES or NO shares back to the pool for at least `minOut` fUSD (after the fee).
    function sell(uint256 id, bool yes, uint256 shares, uint256 minOut, uint64 validUntil, bytes calldata pqSig)
        external
        nonReentrant
        returns (uint256 out)
    {
        Market storage m = _market(id);
        if (m.status != Status.Open || block.timestamp >= m.endTime) revert MarketClosed();
        uint256[2] storage mine = _shares[id][msg.sender];
        if (shares == 0 || mine[yes ? 0 : 1] < shares) revert NotEnoughShares();
        _requirePq(msg.sender, ACTION_SELL, keccak256(abi.encode(id, yes, shares, minOut)), validUntil, pqSig);

        uint256 gross = _sellGross(m, yes, shares);
        uint256 fee = (gross * FEE_BPS) / 10_000;
        out = gross - fee;
        if (out < minOut || out == 0) revert Slippage();
        // The pool takes `shares` of one side and burns `gross` complete sets.
        if (yes) {
            m.yesPool = m.yesPool + shares - gross;
            m.noPool = m.noPool - gross;
        } else {
            m.noPool = m.noPool + shares - gross;
            m.yesPool = m.yesPool - gross;
        }
        mine[yes ? 0 : 1] -= shares;
        m.collateral -= out;
        m.fees += fee;
        m.volume += gross;
        _push(msg.sender, out);
        _traded(id, yes, false, out, shares);
    }

    /// @notice After the dispute delay: redeem the caller's shares (1 fUSD per winning share, 0.5 if Invalid).
    function claim(uint256 id, uint64 validUntil, bytes calldata pqSig) external nonReentrant returns (uint256 payout) {
        Market storage m = _market(id);
        _requireFinal(m);
        if (claimed[id][msg.sender]) revert NothingToClaim();
        payout = payoutOf(id, msg.sender);
        if (payout == 0) revert NothingToClaim();
        _requirePq(msg.sender, ACTION_CLAIM, keccak256(abi.encode(id)), validUntil, pqSig);
        claimed[id][msg.sender] = true;
        m.collateral -= payout;
        _push(msg.sender, payout);
        emit Claimed(id, msg.sender, payout);
    }

    /// @notice The market's creator takes back what the pool holds after resolution (its winning shares + fees).
    function withdrawLiquidity(uint256 id) external nonReentrant returns (uint256 amount) {
        Market storage m = _market(id);
        _requireFinal(m);
        if (msg.sender != m.creator || m.lpWithdrawn) revert NothingToClaim();
        m.lpWithdrawn = true;
        amount = _redeem(m, m.yesPool, m.noPool) + m.fees;
        if (amount > m.collateral) amount = m.collateral;
        m.collateral -= amount;
        _push(msg.sender, amount);
    }

    // ================================================================== views

    function getMarket(uint256 id) external view returns (Market memory) {
        return _markets[id];
    }

    function sharesOf(uint256 id, address who) external view returns (uint256 yes, uint256 no) {
        uint256[2] storage s = _shares[id][who];
        return (s[0], s[1]);
    }

    /// @notice YES price (= implied probability) in millionths.
    function yesPriceE6(uint256 id) public view returns (uint256) {
        Market storage m = _markets[id];
        uint256 t = m.yesPool + m.noPool;
        return t == 0 ? 0 : (m.noPool * 1e6) / t;
    }

    function quoteBuy(uint256 id, bool yes, uint256 amount) public view returns (uint256 shares) {
        Market storage m = _markets[id];
        uint256 net = amount - (amount * FEE_BPS) / 10_000;
        uint256 k = m.yesPool * m.noPool;
        if (yes) {
            uint256 newYes = m.yesPool + net;
            shares = newYes - Math.ceilDiv(k, m.noPool + net);
        } else {
            uint256 newNo = m.noPool + net;
            shares = newNo - Math.ceilDiv(k, m.yesPool + net);
        }
    }

    /// @notice fUSD out (after the fee) for selling `shares`.
    function quoteSell(uint256 id, bool yes, uint256 shares) external view returns (uint256 out) {
        uint256 gross = _sellGross(_markets[id], yes, shares);
        out = gross - (gross * FEE_BPS) / 10_000;
    }

    function payoutOf(uint256 id, address who) public view returns (uint256) {
        Market storage m = _markets[id];
        if (m.status != Status.Resolved || claimed[id][who]) return 0;
        uint256[2] storage s = _shares[id][who];
        return _redeem(m, s[0], s[1]);
    }

    function claimableAt(uint256 id) external view returns (uint64) {
        Market storage m = _markets[id];
        return m.status == Status.Resolved ? m.resolvedAt + DISPUTE_DELAY : 0;
    }

    // ================================================================== internals

    function _market(uint256 id) private view returns (Market storage m) {
        m = _markets[id];
        if (m.endTime == 0) revert BadMarket();
    }

    function _requireFinal(Market storage m) private view {
        if (m.status != Status.Resolved) revert NotResolved();
        if (block.timestamp < m.resolvedAt + DISPUTE_DELAY) revert DisputeWindow();
    }

    function _traded(uint256 id, bool yes, bool isBuy, uint256 collateral, uint256 shares) private {
        emit Traded(id, msg.sender, yes, isBuy, collateral, shares, yesPriceE6(id));
    }

    function _applyBuy(Market storage m, bool yes, uint256 amount) private {
        uint256 fee = (amount * FEE_BPS) / 10_000;
        uint256 net = amount - fee;
        uint256 k = m.yesPool * m.noPool;
        if (yes) {
            m.noPool += net;
            m.yesPool = Math.ceilDiv(k, m.noPool);
        } else {
            m.yesPool += net;
            m.noPool = Math.ceilDiv(k, m.yesPool);
        }
        m.collateral += amount;
        m.fees += fee;
        m.volume += amount;
    }

    function _redeem(Market storage m, uint256 yes, uint256 no) private view returns (uint256) {
        if (m.outcome == Outcome.Yes) return yes;
        if (m.outcome == Outcome.No) return no;
        if (m.outcome == Outcome.Invalid) return (yes + no) / 2;
        return 0;
    }

    /// @dev Complete sets `r` burned when the pool takes `s` shares of one side:
    ///      (a + s - r)(b - r) = a*b, with a = that side's pool and b = the other side's pool.
    ///      r = ((a + s + b) - sqrt((a + s + b)^2 - 4*s*b)) / 2, rounded down (the pool never loses).
    function _sellGross(Market storage m, bool yes, uint256 s) private view returns (uint256 r) {
        uint256 a = yes ? m.yesPool : m.noPool;
        uint256 b = yes ? m.noPool : m.yesPool;
        uint256 sum = a + s + b;
        uint256 disc = sum * sum - 4 * s * b;
        uint256 root = Math.sqrt(disc, Math.Rounding.Ceil);
        r = (sum - root) / 2;
        if (r >= b) r = b - 1;
    }

    function _pull(address from, uint256 amount) private {
        uint256 before = fusd.balanceOf(address(this));
        (bool ok, bytes memory ret) = address(fusd).call(abi.encodeCall(IERC20P.transferFrom, (from, address(this), amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PaymentFailed();
        if (fusd.balanceOf(address(this)) - before != amount) revert PaymentFailed();
    }

    function _push(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = address(fusd).call(abi.encodeCall(IERC20P.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PaymentFailed();
    }
}
