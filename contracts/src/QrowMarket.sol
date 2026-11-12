// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PqAuth} from "./PqAuth.sol";

interface IQrowGenesis {
    function ownerOf(uint256 tokenId) external view returns (address);
    function marketMove(address from, address to, uint256 tokenId) external;
    function market() external view returns (address);
}

interface IERC20Pay {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title  QrowMarket: fixed-price listings for Qrow Genesis, post-quantum protected
/// @notice - list: the seller's ML-DSA-87 signature moves the NFT into this contract (escrow).
///         - buy: the buyer's ML-DSA-87 signature; the price goes straight to the seller and the NFT
///           to the buyer in the same transaction, or nothing happens.
///         - cancel: the seller's ML-DSA-87 signature returns the NFT.
///         Fixed prices only (no auctions, no offers), no fees, no owner, no admin: nobody can
///         take an escrowed NFT or redirect a payment.
contract QrowMarket is ReentrancyGuard, PqAuth {
    bytes32 public constant ACTION_LIST = keccak256("LIST");
    bytes32 public constant ACTION_BUY = keccak256("BUY");
    bytes32 public constant ACTION_CANCEL = keccak256("CANCEL");

    /// @notice A price above this is refused as a likely typo (1,000,000 QOR or 1,000,000 fUSD).
    uint256 public constant MAX_PRICE_QOR = 1_000_000 ether;
    uint256 public constant MAX_PRICE_FUSD = 1_000_000 * 1e6;

    struct Listing {
        address seller;
        uint256 tokenId;
        address currency; // address(0) = QOR, else fUSD
        uint256 price;
        bool active;
    }

    IQrowGenesis public immutable genesis;
    address public immutable fusd;

    uint256 public listingCount;
    mapping(uint256 => Listing) private _listings;
    uint256[] private _active; // active listing ids
    mapping(uint256 => uint256) private _activeIndex; // id => index + 1

    /// @notice QOR owed to sellers whose address rejected a direct payment.
    mapping(address => uint256) public owedNative;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, address currency, uint256 price);
    event Sold(uint256 indexed listingId, address indexed seller, address indexed buyer, uint256 tokenId, address currency, uint256 price);
    event Cancelled(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId);
    event NativeOwed(address indexed seller, uint256 amount);
    event OwedWithdrawn(address indexed seller, uint256 amount);

    error NotTokenOwner();
    error BadCurrency();
    error BadPrice();
    error NotActive();
    error UnknownListing();
    error NotSeller();
    error OwnListing();
    error BadValue();
    error PaymentFailed();
    error NothingOwed();
    error MarketMismatch();

    constructor(address genesis_, address fusd_, string memory nativeChainId_)
        PqAuth(keccak256("QROW_MARKET_V1"), nativeChainId_)
    {
        genesis = IQrowGenesis(genesis_);
        fusd = fusd_;
        // The collection must name this contract as its only market.
        if (genesis.market() != address(this)) revert MarketMismatch();
    }

    // ================================================================== actions

    function list(uint256 tokenId, address currency, uint256 price, uint64 validUntil, bytes calldata pqSig)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (genesis.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (currency != address(0) && currency != fusd) revert BadCurrency();
        if (price == 0 || price > (currency == address(0) ? MAX_PRICE_QOR : MAX_PRICE_FUSD)) revert BadPrice();
        _requirePq(msg.sender, ACTION_LIST, keccak256(abi.encode(tokenId, currency, price)), validUntil, pqSig);

        id = ++listingCount;
        _listings[id] = Listing(msg.sender, tokenId, currency, price, true);
        _active.push(id);
        _activeIndex[id] = _active.length;
        emit Listed(id, msg.sender, tokenId, currency, price);

        genesis.marketMove(msg.sender, address(this), tokenId); // NFT into escrow
    }

    /// @notice Buy at the listed price. The signed parameters include the price, so a listing can
    ///         never charge more than the buyer authorised.
    function buy(uint256 id, uint64 validUntil, bytes calldata pqSig) external payable nonReentrant {
        Listing storage l = _listings[id];
        if (l.seller == address(0)) revert UnknownListing();
        if (!l.active) revert NotActive();
        if (msg.sender == l.seller) revert OwnListing();
        if (l.currency == address(0) ? msg.value != l.price : msg.value != 0) revert BadValue();
        _requirePq(msg.sender, ACTION_BUY, keccak256(abi.encode(id, l.tokenId, l.currency, l.price)), validUntil, pqSig);

        // Effects
        l.active = false;
        _removeActive(id);
        address seller = l.seller;
        uint256 price = l.price;
        uint256 tokenId = l.tokenId;
        emit Sold(id, seller, msg.sender, tokenId, l.currency, price);

        // Interactions: pay the seller, then hand over the NFT. Any failure reverts everything,
        // except a seller that rejects QOR, which is credited for withdrawal instead.
        if (l.currency == address(0)) {
            (bool ok,) = seller.call{value: price}("");
            if (!ok) {
                owedNative[seller] += price;
                emit NativeOwed(seller, price);
            }
        } else {
            uint256 before = IERC20Pay(fusd).balanceOf(seller);
            (bool ok, bytes memory ret) = fusd.call(abi.encodeCall(IERC20Pay.transferFrom, (msg.sender, seller, price)));
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PaymentFailed();
            if (IERC20Pay(fusd).balanceOf(seller) - before != price) revert PaymentFailed();
        }
        genesis.marketMove(address(this), msg.sender, tokenId);
    }

    function cancel(uint256 id, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        Listing storage l = _listings[id];
        if (l.seller == address(0)) revert UnknownListing();
        if (!l.active) revert NotActive();
        if (msg.sender != l.seller) revert NotSeller();
        _requirePq(msg.sender, ACTION_CANCEL, keccak256(abi.encode(id)), validUntil, pqSig);

        l.active = false;
        _removeActive(id);
        emit Cancelled(id, l.seller, l.tokenId);
        genesis.marketMove(address(this), l.seller, l.tokenId);
    }

    /// @notice Always pays msg.sender, so it can't be redirected.
    function withdrawOwed() external nonReentrant {
        uint256 amount = owedNative[msg.sender];
        if (amount == 0) revert NothingOwed();
        owedNative[msg.sender] = 0;
        emit OwedWithdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }

    // ================================================================== views

    function getListing(uint256 id) external view returns (Listing memory) {
        return _listings[id];
    }

    function activeListingIds() external view returns (uint256[] memory) {
        return _active;
    }

    /// @notice Lowest active price in `currency` (0 when nothing is listed in it). Bounded: the
    ///         collection has 256 tokens, so at most 256 active listings.
    function floorPrice(address currency) external view returns (uint256 floor, uint256 listingId) {
        for (uint256 i = 0; i < _active.length; i++) {
            Listing storage l = _listings[_active[i]];
            if (l.currency == currency && (floor == 0 || l.price < floor)) {
                floor = l.price;
                listingId = _active[i];
            }
        }
    }

    function _removeActive(uint256 id) private {
        uint256 idx = _activeIndex[id];
        uint256 last = _active[_active.length - 1];
        _active[idx - 1] = last;
        _activeIndex[last] = idx;
        _active.pop();
        delete _activeIndex[id];
    }
}
