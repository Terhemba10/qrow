// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PqAuth} from "./PqAuth.sol";

interface IERC20E {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title  QrowEditions: create-your-own NFTs (ERC-1155 editions) with a built-in marketplace, post-quantum protected
/// @notice - create: anyone mints an edition of 1 to 10,000 copies of their own artwork (image and metadata on IPFS);
///           every copy goes to the creator. Network fees are paid in test QOR.
///         - send: the owner's ML-DSA-87 signature moves copies to another address.
///         - list / buy / cancel: fixed price per copy in fUSD; listed copies wait in this contract (escrow),
///           buyers may take part of a listing, the price goes straight to the seller.
///         Plain ERC-1155 transfers and approvals are switched off, so a leaked secp256k1 key alone can't move
///         anything. No owner, no admin, no fees. Testnet only.
contract QrowEditions is ERC1155, ReentrancyGuard, PqAuth {
    bytes32 public constant ACTION_CREATE = keccak256("EDITION_CREATE");
    bytes32 public constant ACTION_SEND = keccak256("EDITION_SEND");
    bytes32 public constant ACTION_LIST = keccak256("EDITION_LIST");
    bytes32 public constant ACTION_BUY = keccak256("EDITION_BUY");
    bytes32 public constant ACTION_CANCEL = keccak256("EDITION_CANCEL");

    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MAX_PRICE = 1_000_000 * 1e6; // 1,000,000 fUSD per copy: anything above is a typo
    string public constant name = "Qrow Editions";
    string public constant symbol = "QED";

    struct Edition {
        address creator;
        uint64 createdAt;
        uint256 supply;
        string uri; // ipfs://<metadata CID>
    }

    struct Listing {
        address seller;
        uint256 editionId;
        uint256 amount; // copies still for sale
        uint256 price; // fUSD units per copy
        bool active;
    }

    address public immutable fusd;
    uint256 public editionCount;
    mapping(uint256 => Edition) private _editions;
    mapping(address => uint256[]) private _created;

    uint256 public listingCount;
    mapping(uint256 => Listing) private _listings;
    uint256[] private _active;
    mapping(uint256 => uint256) private _activeIndex; // id => index + 1

    event EditionCreated(uint256 indexed id, address indexed creator, uint256 supply, string uri);
    event Sent(uint256 indexed id, address indexed from, address indexed to, uint256 amount);
    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed editionId, uint256 amount, uint256 price);
    event Bought(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 paid);
    event Cancelled(uint256 indexed listingId, address indexed seller, uint256 returned);

    error BadSupply();
    error BadUri();
    error UnknownEdition();
    error BadAmount();
    error BadPrice();
    error BadRecipient();
    error NotActive();
    error NotSeller();
    error OwnListing();
    error PaymentFailed();
    error TransfersDisabled();

    constructor(address fusd_, string memory nativeChainId_, address keys_)
        ERC1155("")
        PqAuth(keccak256("QROW_EDITIONS_V1"), nativeChainId_, keys_)
    {
        fusd = fusd_;
    }

    // ================================================================== create + send

    function create(string calldata metadataUri, uint256 supply, uint64 validUntil, bytes calldata pqSig)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (supply == 0 || supply > MAX_SUPPLY) revert BadSupply();
        bytes memory u = bytes(metadataUri);
        if (u.length < 8 || u.length > 200) revert BadUri();
        _requirePq(msg.sender, ACTION_CREATE, keccak256(abi.encode(keccak256(u), supply)), validUntil, pqSig);
        id = ++editionCount;
        _editions[id] = Edition(msg.sender, uint64(block.timestamp), supply, metadataUri);
        _created[msg.sender].push(id);
        emit EditionCreated(id, msg.sender, supply, metadataUri);
        _move(address(0), msg.sender, id, supply, true);
    }

    function send(address to, uint256 id, uint256 amount, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        if (to == address(0) || to == address(this) || to == msg.sender) revert BadRecipient();
        if (amount == 0 || balanceOf(msg.sender, id) < amount) revert BadAmount();
        _requirePq(msg.sender, ACTION_SEND, keccak256(abi.encode(to, id, amount)), validUntil, pqSig);
        emit Sent(id, msg.sender, to, amount);
        _move(msg.sender, to, id, amount, true);
    }

    // ================================================================== marketplace

    function list(uint256 id, uint256 amount, uint256 price, uint64 validUntil, bytes calldata pqSig)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        if (_editions[id].creator == address(0)) revert UnknownEdition();
        if (amount == 0 || balanceOf(msg.sender, id) < amount) revert BadAmount();
        if (price == 0 || price > MAX_PRICE) revert BadPrice();
        _requirePq(msg.sender, ACTION_LIST, keccak256(abi.encode(id, amount, price)), validUntil, pqSig);
        listingId = ++listingCount;
        _listings[listingId] = Listing(msg.sender, id, amount, price, true);
        _active.push(listingId);
        _activeIndex[listingId] = _active.length;
        emit Listed(listingId, msg.sender, id, amount, price);
        _move(msg.sender, address(this), id, amount, false);
    }

    /// @notice Buy `amount` copies at the listed price; the signature covers the price, so it can't change under you.
    function buy(uint256 listingId, uint256 amount, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        Listing storage l = _listings[listingId];
        if (!l.active) revert NotActive();
        if (msg.sender == l.seller) revert OwnListing();
        if (amount == 0 || amount > l.amount) revert BadAmount();
        _requirePq(msg.sender, ACTION_BUY, keccak256(abi.encode(listingId, l.editionId, amount, l.price)), validUntil, pqSig);
        uint256 paid = amount * l.price;
        l.amount -= amount;
        if (l.amount == 0) {
            l.active = false;
            _removeActive(listingId);
        }
        emit Bought(listingId, msg.sender, amount, paid);

        uint256 before = IERC20E(fusd).balanceOf(l.seller);
        (bool ok, bytes memory ret) = fusd.call(abi.encodeCall(IERC20E.transferFrom, (msg.sender, l.seller, paid)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PaymentFailed();
        if (IERC20E(fusd).balanceOf(l.seller) - before != paid) revert PaymentFailed();
        _move(address(this), msg.sender, l.editionId, amount, true);
    }

    function cancel(uint256 listingId, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        Listing storage l = _listings[listingId];
        if (!l.active) revert NotActive();
        if (msg.sender != l.seller) revert NotSeller();
        _requirePq(msg.sender, ACTION_CANCEL, keccak256(abi.encode(listingId)), validUntil, pqSig);
        uint256 back = l.amount;
        l.active = false;
        l.amount = 0;
        _removeActive(listingId);
        emit Cancelled(listingId, msg.sender, back);
        _move(address(this), msg.sender, l.editionId, back, false);
    }

    // ================================================================== views

    function uri(uint256 id) public view override returns (string memory) {
        return _editions[id].uri;
    }

    function getEdition(uint256 id) external view returns (Edition memory) {
        return _editions[id];
    }

    function createdBy(address who) external view returns (uint256[] memory) {
        return _created[who];
    }

    function getListing(uint256 id) external view returns (Listing memory) {
        return _listings[id];
    }

    function activeListingIds() external view returns (uint256[] memory) {
        return _active;
    }

    /// @notice Editions `who` holds among ids [from, from + count): ids and balances (Portfolio).
    function holdings(address who, uint256 from, uint256 count) external view returns (uint256[] memory ids, uint256[] memory bals) {
        uint256 end = from + count;
        if (end > editionCount + 1) end = editionCount + 1;
        uint256 n;
        for (uint256 i = from; i < end; i++) if (balanceOf(who, i) > 0) n++;
        ids = new uint256[](n);
        bals = new uint256[](n);
        n = 0;
        for (uint256 i = from; i < end; i++) {
            uint256 b = balanceOf(who, i);
            if (b > 0) {
                ids[n] = i;
                bals[n++] = b;
            }
        }
    }

    // ================================================================== plain transfers are off

    function setApprovalForAll(address, bool) public pure override {
        revert TransfersDisabled();
    }

    function safeTransferFrom(address, address, uint256, uint256, bytes memory) public pure override {
        revert TransfersDisabled();
    }

    function safeBatchTransferFrom(address, address, uint256[] memory, uint256[] memory, bytes memory) public pure override {
        revert TransfersDisabled();
    }

    // ================================================================== internals

    function _move(address from, address to, uint256 id, uint256 amount, bool check) private {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory vals = new uint256[](1);
        ids[0] = id;
        vals[0] = amount;
        if (check) _updateWithAcceptanceCheck(from, to, ids, vals, "");
        else _update(from, to, ids, vals);
    }

    function _removeActive(uint256 id) private {
        uint256 idx = _activeIndex[id];
        if (idx == 0) return;
        uint256 last = _active[_active.length - 1];
        _active[idx - 1] = last;
        _activeIndex[last] = idx;
        _active.pop();
        delete _activeIndex[id];
    }
}
