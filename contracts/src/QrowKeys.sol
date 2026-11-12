// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./IQorePQC.sol";
import {PqAuth} from "./PqAuth.sol";

/// @title  QrowKeys: one Qrow app key (ML-DSA-87) per account, shared by every Qrow contract
/// @notice Why: QoreX holds each account's chain-registered ML-DSA-87 key but can't sign messages,
///         so a QoreX user can't produce the per-action signatures Qrow's contracts verify with
///         pqcVerify. Qrow instead generates a separate ML-DSA-87 key in the browser (saved by the
///         user as a QRC1 recovery code) and registers it here once. Every action is still checked
///         with pqcVerify, against this key.
///
///         Safeguards:
///         - Registering needs a key registered on QoreChain with proof of possession, so the
///           account's EVM lane is already gated by ML-DSA: a stolen secp256k1 key alone can't even
///           open the EVM window the registration has to travel through.
///         - Registering proves possession of the new key (it signs the registration itself).
///         - Rotating or revoking needs a signature from the current app key.
///         - Lost code: a reset takes RESET_DELAY (3 days) and the current app key can cancel it,
///           so a thief who somehow sends one EVM transaction still can't swap the key quietly.
///         - No owner, no admin, no upgrade path.
contract QrowKeys is PqAuth {
    bytes32 public constant ACTION_REGISTER = keccak256("REGISTER_APP_KEY");
    bytes32 public constant ACTION_ROTATE = keccak256("ROTATE_APP_KEY");
    bytes32 public constant ACTION_REVOKE = keccak256("REVOKE_APP_KEY");
    bytes32 public constant ACTION_CANCEL_RESET = keccak256("CANCEL_RESET");
    uint64 public constant RESET_DELAY = 3 days;

    mapping(address => bytes) private _appKey;
    /// @notice When a pending reset of the account's app key can be finished (0 = none pending).
    mapping(address => uint64) public resetAt;

    event AppKeyRegistered(address indexed account, bytes32 indexed keyHash);
    event AppKeyRotated(address indexed account, bytes32 indexed oldKeyHash, bytes32 indexed newKeyHash);
    event AppKeyRevoked(address indexed account, bytes32 indexed keyHash);
    event ResetRequested(address indexed account, uint64 finishAfter);
    event ResetCancelled(address indexed account);
    event ResetFinished(address indexed account, bytes32 indexed keyHash);

    error AlreadyRegistered();
    error NoAppKey();
    error NoChainPqKey();
    error BadKeyLength();
    error ResetPending();
    error NoResetPending();
    error ResetNotDue();

    constructor(string memory nativeChainId_) PqAuth(keccak256("QROW_KEYS_V1"), nativeChainId_, address(0)) {}

    // ================================================================== views

    function appKeyOf(address account) external view returns (bytes memory) {
        return _appKey[account];
    }

    function hasAppKey(address account) public view returns (bool) {
        return _appKey[account].length != 0;
    }

    /// @inheritdoc PqAuth
    function pqKeyOf(address account) public view override returns (bytes memory) {
        bytes memory k = _appKey[account];
        return k.length != 0 ? k : QorePQC.provenKey(account);
    }

    /// @notice What every Qrow contract verifies against: the app key, else the chain key.
    function keyOf(address account) external view returns (bytes memory) {
        return pqKeyOf(account);
    }

    // ================================================================== actions

    /// @notice Register an app key. `pop` is the NEW key's signature over this registration.
    function register(bytes calldata pubkey, uint64 validUntil, bytes calldata pop) external {
        if (_appKey[msg.sender].length != 0) revert AlreadyRegistered();
        if (QorePQC.provenKey(msg.sender).length == 0) revert NoChainPqKey();
        if (pubkey.length != QorePQC.ML_DSA_87_PUBKEY_LEN) revert BadKeyLength();
        _requirePqWith(pubkey, msg.sender, ACTION_REGISTER, keccak256(pubkey), validUntil, pop);
        _appKey[msg.sender] = pubkey;
        emit AppKeyRegistered(msg.sender, keccak256(pubkey));
    }

    /// @notice Replace the app key: signed by the current key (`sig`) and by the new one (`pop`).
    function rotate(bytes calldata newPubkey, uint64 validUntil, bytes calldata sig, bytes calldata pop) external {
        bytes memory old = _appKey[msg.sender];
        if (old.length == 0) revert NoAppKey();
        if (newPubkey.length != QorePQC.ML_DSA_87_PUBKEY_LEN) revert BadKeyLength();
        bytes32 newHash = keccak256(newPubkey);
        _requirePqWith(old, msg.sender, ACTION_ROTATE, newHash, validUntil, sig);
        _requirePqWith(newPubkey, msg.sender, ACTION_REGISTER, newHash, validUntil, pop);
        _appKey[msg.sender] = newPubkey;
        resetAt[msg.sender] = 0;
        emit AppKeyRotated(msg.sender, keccak256(old), newHash);
    }

    /// @notice Remove the app key (back to the chain key), signed by the current app key.
    function revoke(uint64 validUntil, bytes calldata sig) external {
        bytes memory old = _appKey[msg.sender];
        if (old.length == 0) revert NoAppKey();
        _requirePqWith(old, msg.sender, ACTION_REVOKE, bytes32(0), validUntil, sig);
        delete _appKey[msg.sender];
        resetAt[msg.sender] = 0;
        emit AppKeyRevoked(msg.sender, keccak256(old));
    }

    /// @notice Lost the recovery code? Start a reset; it can be finished after RESET_DELAY.
    function requestReset() external {
        if (_appKey[msg.sender].length == 0) revert NoAppKey();
        if (resetAt[msg.sender] != 0) revert ResetPending();
        uint64 due = uint64(block.timestamp) + RESET_DELAY;
        resetAt[msg.sender] = due;
        emit ResetRequested(msg.sender, due);
    }

    /// @notice Stop a reset you didn't ask for, signed by the current app key.
    function cancelReset(uint64 validUntil, bytes calldata sig) external {
        if (resetAt[msg.sender] == 0) revert NoResetPending();
        _requirePqWith(_appKey[msg.sender], msg.sender, ACTION_CANCEL_RESET, bytes32(0), validUntil, sig);
        resetAt[msg.sender] = 0;
        emit ResetCancelled(msg.sender);
    }

    /// @notice After the delay, remove the app key so a new one can be registered.
    function finishReset() external {
        uint64 due = resetAt[msg.sender];
        if (due == 0) revert NoResetPending();
        if (block.timestamp < due) revert ResetNotDue();
        bytes32 h = keccak256(_appKey[msg.sender]);
        delete _appKey[msg.sender];
        resetAt[msg.sender] = 0;
        emit ResetFinished(msg.sender, h);
    }
}
