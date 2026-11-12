// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PqAuth} from "./PqAuth.sol";

/// @title  QrowCoin: a testnet memecoin from the Qrow launcher, with anti-rug rules built in
/// @notice Not configurable, by design:
///         - Fixed supply, minted once in the constructor. No mint function exists.
///         - No owner powers at all: no pause, no blacklist, no fees, no transfer blocks.
///         - Creator share is capped at 10% (enforced by the factory) and public on chain.
///         - The rest sits in this contract as a public claim: any address with a registered
///           ML-DSA-87 key can claim one fixed share, once, with a post-quantum signature.
///         Plain OpenZeppelin ERC-20 transfers otherwise, so the coin works in Send and wallets.
///         Testnet memecoin: no real value. Never buy coins expecting profit.
contract QrowCoin is ERC20, ReentrancyGuard, PqAuth {
    bytes32 public constant ACTION_CLAIM = keccak256("CLAIM");
    /// @notice Each claim is 1/1000 of the public pool.
    uint256 public constant CLAIM_DIVISOR = 1000;

    address public immutable creator;
    address public immutable factory;
    uint16 public immutable creatorBps;
    uint256 public immutable creatorAmount;
    uint256 public immutable publicPool;
    uint256 public immutable claimAmount;
    uint64 public immutable launchedAt;
    string public description;

    mapping(address => bool) public claimed;

    event Claimed(address indexed account, uint256 amount);

    error AlreadyClaimed();
    error PoolEmpty();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupplyWei,
        address creator_,
        uint16 creatorBps_,
        string memory description_,
        string memory nativeChainId_
    ) ERC20(name_, symbol_) PqAuth(keccak256("QROW_COIN_V1"), nativeChainId_) {
        creator = creator_;
        factory = msg.sender;
        creatorBps = creatorBps_;
        launchedAt = uint64(block.timestamp);
        description = description_;
        creatorAmount = (totalSupplyWei * creatorBps_) / 10_000;
        publicPool = totalSupplyWei - creatorAmount;
        claimAmount = publicPool / CLAIM_DIVISOR;
        if (creatorAmount != 0) _mint(creator_, creatorAmount);
        _mint(address(this), publicPool);
    }

    /// @notice Claim one share of the public pool (once per address, post-quantum signed).
    function claim(uint64 validUntil, bytes calldata pqSig) external nonReentrant returns (uint256 amount) {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        uint256 left = balanceOf(address(this));
        if (left == 0) revert PoolEmpty();
        _requirePq(msg.sender, ACTION_CLAIM, keccak256(abi.encode(address(this))), validUntil, pqSig);
        claimed[msg.sender] = true;
        amount = left < claimAmount ? left : claimAmount;
        _transfer(address(this), msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function remainingPublic() external view returns (uint256) {
        return balanceOf(address(this));
    }
}
