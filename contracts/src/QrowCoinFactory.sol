// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PqAuth} from "./PqAuth.sol";
import {QrowCoin} from "./QrowCoin.sol";

/// @title  QrowCoinFactory: launches QrowCoin memecoins with fixed, non-configurable safety rules
/// @notice Every launch is post-quantum signed by the creator and checked on chain:
///         - name 3 to 32 characters (letters, digits, single spaces); symbol 2 to 8 (A-Z, 0-9);
///         - supply 1,000 to 1,000,000,000,000 whole tokens, 18 decimals;
///         - creator share at most 10%;
///         - names and symbols that impersonate real coins, chains or brands are refused
///           (the app's checking agent adds a fuzzier check and duplicate-symbol warnings).
///         The factory has no owner and keeps no funds; it only records what was launched.
contract QrowCoinFactory is ReentrancyGuard, PqAuth {
    bytes32 public constant ACTION_LAUNCH = keccak256("LAUNCH");
    uint16 public constant MAX_CREATOR_BPS = 1_000; // 10%
    uint256 public constant MIN_SUPPLY = 1_000;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000;
    uint256 public constant MAX_DESCRIPTION = 280;

    address[] private _coins;
    mapping(address => bool) public isQrowCoin;
    mapping(bytes32 => uint256) public symbolCount; // keccak256(symbol) => launches with it

    event CoinLaunched(
        address indexed coin,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply,
        uint16 creatorBps,
        uint256 index
    );

    error BadName();
    error BadSymbol();
    error BadSupply();
    error CreatorShareTooHigh();
    error DescriptionTooLong();
    error Impersonation(string matched);

    constructor(string memory nativeChainId_, address keys_) PqAuth(keccak256("QROW_COIN_FACTORY_V1"), nativeChainId_, keys_) {}

    function launch(
        string calldata name,
        string calldata symbol,
        uint256 supplyWhole,
        uint16 creatorBps,
        string calldata description,
        uint64 validUntil,
        bytes calldata pqSig
    ) external nonReentrant returns (address coin) {
        _checkName(name);
        _checkSymbol(symbol);
        if (supplyWhole < MIN_SUPPLY || supplyWhole > MAX_SUPPLY) revert BadSupply();
        if (creatorBps > MAX_CREATOR_BPS) revert CreatorShareTooHigh();
        if (bytes(description).length > MAX_DESCRIPTION) revert DescriptionTooLong();
        _checkImpersonation(name, symbol);
        _requirePq(
            msg.sender,
            ACTION_LAUNCH,
            keccak256(abi.encode(keccak256(bytes(name)), keccak256(bytes(symbol)), supplyWhole, creatorBps, keccak256(bytes(description)))),
            validUntil,
            pqSig
        );

        coin = address(new QrowCoin(name, symbol, supplyWhole * 1e18, msg.sender, creatorBps, description, nativeChainId, address(KEYS)));
        _coins.push(coin);
        isQrowCoin[coin] = true;
        symbolCount[keccak256(bytes(symbol))] += 1;
        emit CoinLaunched(coin, msg.sender, name, symbol, supplyWhole * 1e18, creatorBps, _coins.length - 1);
    }

    // ================================================================== views

    function coinCount() external view returns (uint256) {
        return _coins.length;
    }

    function coins(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 n = _coins.length;
        if (offset >= n) return new address[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) page[i - offset] = _coins[i];
    }

    /// @notice Run the on-chain name rules without launching (the app uses this before signing).
    function checkNames(string calldata name, string calldata symbol) external pure returns (bool ok, string memory reason) {
        bytes memory n = bytes(name);
        if (n.length < 3 || n.length > 32 || !_validName(n)) return (false, "bad name");
        bytes memory s = bytes(symbol);
        if (s.length < 2 || s.length > 8 || !_validSymbol(s)) return (false, "bad symbol");
        (bool hit, string memory matched) = _impersonates(name, symbol);
        if (hit) return (false, matched);
        return (true, "");
    }

    // ================================================================== rules

    function _checkName(string calldata name) private pure {
        bytes memory n = bytes(name);
        if (n.length < 3 || n.length > 32 || !_validName(n)) revert BadName();
    }

    function _checkSymbol(string calldata symbol) private pure {
        bytes memory s = bytes(symbol);
        if (s.length < 2 || s.length > 8 || !_validSymbol(s)) revert BadSymbol();
    }

    function _validName(bytes memory n) private pure returns (bool) {
        if (n[0] == " " || n[n.length - 1] == " ") return false;
        for (uint256 i = 0; i < n.length; i++) {
            bytes1 c = n[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == " ";
            if (!ok) return false;
            if (c == " " && n[i - 1] == " ") return false; // no double spaces (i > 0 here)
        }
        return true;
    }

    function _validSymbol(bytes memory s) private pure returns (bool) {
        for (uint256 i = 0; i < s.length; i++) {
            bytes1 c = s[i];
            if (!((c >= "A" && c <= "Z") || (c >= "0" && c <= "9"))) return false;
        }
        return true;
    }

    function _checkImpersonation(string calldata name, string calldata symbol) private pure {
        (bool hit, string memory matched) = _impersonates(name, symbol);
        if (hit) revert Impersonation(matched);
    }

    /// @dev Name: lowercase letters and digits only (spaces dropped), then a substring match against
    ///      well-known coins, chains and brands. Symbol: exact match against well-known tickers, plus
    ///      substrings BTC, ETH, USD and QOR anywhere in the symbol.
    function _impersonates(string memory name, string memory symbol) private pure returns (bool, string memory) {
        bytes memory n = _squash(bytes(name));
        string[30] memory names = [
            "bitcoin", "ethereum", "ether", "qorechain", "qore", "qrow", "tether", "usdc", "usdt", "dogecoin",
            "shiba", "pepe", "solana", "binance", "ripple", "cardano", "polkadot", "chainlink", "litecoin", "tron",
            "avalanche", "polygon", "coinbase", "metamask", "uniswap", "circle", "paypal", "stablecoin", "toncoin", "monero"
        ];
        for (uint256 i = 0; i < names.length; i++) {
            if (_contains(n, bytes(names[i]))) return (true, names[i]);
        }
        bytes memory s = bytes(symbol);
        string[24] memory tickers = [
            "BTC", "ETH", "QOR", "USD", "USDT", "USDC", "DAI", "BNB", "SOL", "XRP", "ADA", "DOGE",
            "SHIB", "PEPE", "TRX", "DOT", "LINK", "LTC", "AVAX", "MATIC", "POL", "TON", "XMR", "QROW"
        ];
        for (uint256 i = 0; i < tickers.length; i++) {
            bytes memory t = bytes(tickers[i]);
            bool substringRule = i < 4; // BTC, ETH, QOR, USD anywhere (WBTC, FETH, FUSD, QORX...)
            if (substringRule ? _contains(s, t) : keccak256(s) == keccak256(t)) return (true, tickers[i]);
        }
        return (false, "");
    }

    function _squash(bytes memory b) private pure returns (bytes memory out) {
        out = new bytes(b.length);
        uint256 k;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= "A" && c <= "Z") out[k++] = bytes1(uint8(c) + 32);
            else if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) out[k++] = c;
        }
        assembly {
            mstore(out, k)
        }
    }

    function _contains(bytes memory hay, bytes memory needle) private pure returns (bool) {
        if (needle.length > hay.length) return false;
        for (uint256 i = 0; i + needle.length <= hay.length; i++) {
            bool m = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    m = false;
                    break;
                }
            }
            if (m) return true;
        }
        return false;
    }
}
