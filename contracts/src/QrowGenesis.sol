// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {PqAuth} from "./PqAuth.sol";

interface IERC20Pull {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title  Qrow Genesis: a post-quantum NFT collection (ERC-721, testnet)
/// @notice Original generative artwork rendered fully on chain from each token id: loops that
///         leave the ring and come back, the idea behind the Qrow mark. Nothing is copied.
///
///         Ownership moves only with a post-quantum signature:
///         - `pqTransfer`: the owner signs the transfer with their ML-DSA-87 key;
///         - the Qrow market, which verifies ML-DSA-87 on list, buy and cancel.
///         Plain `transferFrom`, `safeTransferFrom`, `approve` and `setApprovalForAll` are refused,
///         so a leaked ECDSA key (or an approval-phishing signature) can't move a Genesis NFT.
///
///         Minting costs a fixed price in QOR or fUSD, set at deploy and paid straight to the
///         immutable beneficiary in the same transaction. The contract never holds funds and has
///         no owner, no admin and no way to change prices or move NFTs.
contract QrowGenesis is ERC721, ReentrancyGuard, PqAuth {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 256;
    uint256 public constant MAX_PER_WALLET = 5;

    bytes32 public constant ACTION_MINT = keccak256("MINT");
    bytes32 public constant ACTION_TRANSFER = keccak256("TRANSFER");

    /// @notice The only contract allowed to move tokens without the owner's own pqTransfer.
    address public immutable market;
    address public immutable beneficiary;
    address public immutable fusd;
    uint256 public immutable priceQor; // wei (QOR has 18 decimals)
    uint256 public immutable priceFusd; // fUSD base units (6 decimals)

    uint256 public totalMinted;
    mapping(address => uint256) public mintedBy;

    bool private transient _moving;

    event Minted(uint256 indexed tokenId, address indexed to, address currency, uint256 price);
    event PqTransfer(uint256 indexed tokenId, address indexed from, address indexed to);

    error SoldOut();
    error WalletLimit();
    error BadCurrency();
    error BadValue();
    error PaymentFailed();
    error TransfersNeedPq();
    error ApprovalsDisabled();
    error NotMarket();
    error NotOwner();
    error BadRecipient();

    constructor(
        address market_,
        address beneficiary_,
        address fusd_,
        uint256 priceQor_,
        uint256 priceFusd_,
        string memory nativeChainId_
    ) ERC721("Qrow Genesis", "QROWG") PqAuth(keccak256("QROW_GENESIS_V1"), nativeChainId_) {
        if (market_ == address(0) || beneficiary_ == address(0) || fusd_ == address(0)) revert BadRecipient();
        if (priceQor_ == 0 || priceFusd_ == 0) revert BadValue();
        market = market_;
        beneficiary = beneficiary_;
        fusd = fusd_;
        priceQor = priceQor_;
        priceFusd = priceFusd_;
    }

    // ================================================================== mint

    /// @notice Mint one token, paying `priceQor` (currency = address(0), as msg.value) or
    ///         `priceFusd` (currency = fusd, approved to this contract).
    function mint(address currency, uint64 validUntil, bytes calldata pqSig)
        external
        payable
        nonReentrant
        returns (uint256 tokenId)
    {
        if (totalMinted >= MAX_SUPPLY) revert SoldOut();
        if (mintedBy[msg.sender] >= MAX_PER_WALLET) revert WalletLimit();
        uint256 price;
        if (currency == address(0)) {
            price = priceQor;
            if (msg.value != price) revert BadValue();
        } else if (currency == fusd) {
            price = priceFusd;
            if (msg.value != 0) revert BadValue();
        } else {
            revert BadCurrency();
        }
        _requirePq(msg.sender, ACTION_MINT, keccak256(abi.encode(currency, price)), validUntil, pqSig);

        // Effects
        tokenId = ++totalMinted;
        mintedBy[msg.sender] += 1;
        _safeMint(msg.sender, tokenId);
        emit Minted(tokenId, msg.sender, currency, price);

        // Interaction: pay the beneficiary directly; nothing is held here.
        if (currency == address(0)) {
            (bool ok,) = beneficiary.call{value: price}("");
            if (!ok) revert PaymentFailed();
        } else {
            uint256 before = IERC20Pull(fusd).balanceOf(beneficiary);
            (bool ok, bytes memory ret) = fusd.call(abi.encodeCall(IERC20Pull.transferFrom, (msg.sender, beneficiary, price)));
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PaymentFailed();
            if (IERC20Pull(fusd).balanceOf(beneficiary) - before != price) revert PaymentFailed();
        }
    }

    // ================================================================== post-quantum moves

    /// @notice The owner moves a token with an ML-DSA-87 signature.
    function pqTransfer(address to, uint256 tokenId, uint64 validUntil, bytes calldata pqSig) external nonReentrant {
        if (to == address(0) || to == address(this)) revert BadRecipient();
        if (_ownerOf(tokenId) != msg.sender) revert NotOwner();
        _requirePq(msg.sender, ACTION_TRANSFER, keccak256(abi.encode(to, tokenId)), validUntil, pqSig);
        _moving = true;
        _transfer(msg.sender, to, tokenId);
        _moving = false;
        emit PqTransfer(tokenId, msg.sender, to);
    }

    /// @notice Only the Qrow market, after verifying the seller's or buyer's ML-DSA-87 signature.
    function marketMove(address from, address to, uint256 tokenId) external {
        if (msg.sender != market) revert NotMarket();
        _moving = true;
        _transfer(from, to, tokenId);
        _moving = false;
    }

    /// @dev Every ownership change other than a mint must come from pqTransfer or marketMove.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0) && !_moving) revert TransfersNeedPq();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert ApprovalsDisabled();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert ApprovalsDisabled();
    }

    // ================================================================== art

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        (string memory svg, uint256 loops, bool inkGround, bool accent) = _art(tokenId);
        string memory json = string.concat(
            '{"name":"Qrow Genesis #',
            tokenId.toString(),
            '","description":"Qrow Genesis: loops that leave the ring and come back. Original generative art, rendered on chain. Testnet NFT with no value.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"Loops","value":',
            loops.toString(),
            '},{"trait_type":"Ground","value":"',
            inkGround ? "Ink" : "Paper",
            '"},{"trait_type":"Settled","value":"',
            accent ? "Yes" : "No",
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev Deterministic composition from keccak256(tokenId): a ring with N loops (3 to 7)
    ///      rotated around it, one optionally in coral (the "settled" ink). 320×320.
    function _art(uint256 tokenId) internal pure returns (string memory svg, uint256 loops, bool inkGround, bool accent) {
        uint256 seed = uint256(keccak256(abi.encode("QROW_GENESIS_ART", tokenId)));
        loops = 3 + (seed % 5);
        inkGround = (seed >> 8) % 3 == 0;
        accent = (seed >> 16) % 4 == 0;
        string memory ground = inkGround ? "#1F1A18" : "#F8F5F2";
        string memory ink = inkGround ? "#F5F1EC" : "#1F1A18";
        uint256 start = (seed >> 24) % 360;
        uint256 width = 6 + ((seed >> 40) % 5); // stroke 6 to 10
        string memory paths;
        for (uint256 i = 0; i < loops; i++) {
            uint256 angle = (start + (i * 360) / loops) % 360;
            uint256 reach = 40 + ((seed >> (48 + i * 8)) % 50); // how far the loop travels out
            bool coral = accent && i == 0;
            paths = string.concat(
                paths,
                '<path d="M200 160 C',
                (200 + reach).toString(),
                " ",
                (150 - reach / 3).toString(),
                " ",
                (205 + reach).toString(),
                " ",
                (175 + reach / 3).toString(),
                ' 200 172" transform="rotate(',
                angle.toString(),
                ' 160 160)" stroke="',
                coral ? "#B4483B" : ink,
                '"/>'
            );
        }
        svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" fill="',
            ground,
            '"/><g fill="none" stroke-width="',
            width.toString(),
            '" stroke-linecap="round" stroke-linejoin="round"><circle cx="160" cy="160" r="40" stroke="',
            ink,
            '"/>',
            paths,
            "</g></svg>"
        );
    }
}
