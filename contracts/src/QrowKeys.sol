// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./IQorePQC.sol";
import {PqAuth} from "./PqAuth.sol";

/// @title  QrowKeys v3: invisible per-device ML-DSA-87 keys, shared by every Qrow contract
/// @notice Why: QoreX holds each account's chain-registered ML-DSA-87 key and signs native-lane
///         transactions (including MsgCrossVMCall, which reaches Qrow's EVM contracts as the user),
///         but it can't sign the messages pqcVerify checks. So each browser the user uses holds a
///         Qrow *device key* (ML-DSA-87), generated and stored by the app behind a passkey and never
///         shown. Every Qrow action is still verified with pqcVerify against one of these keys.
///
///         Signatures: a device-key signature is `uint8 slot || ML-DSA-87 signature` (4,628 bytes).
///         A bare 4,627-byte signature means the account's chain-registered key (script accounts).
///
///         Adding devices:
///         - The first device registers instantly (it signs its own registration).
///         - Another device registers instantly if an existing device approves it, or
///         - after PROPOSAL_DELAY (3 days), during which the account or any device can cancel it and
///           the watcher alerts the owner. No recovery code exists anywhere.
///         Every change needs msg.sender == the account. On QoreChain that is only reachable with the
///         account's ML-DSA-87 key (a hybrid-signed MsgCrossVMCall, or an EVM transaction inside a
///         window that itself needs ML-DSA), so a leaked secp256k1 key alone changes nothing.
///         No owner, no admin, no upgrade path.
contract QrowKeys is PqAuth {
    bytes32 public constant ACTION_ADD_DEVICE = keccak256("ADD_DEVICE");
    bytes32 public constant ACTION_APPROVE_DEVICE = keccak256("APPROVE_DEVICE");
    uint8 public constant MAX_DEVICES = 8;
    uint64 public constant PROPOSAL_DELAY = 3 days;

    struct Proposal {
        bytes pubkey;
        uint64 dueAt;
    }

    mapping(address => mapping(uint8 => bytes)) private _device;
    mapping(address => uint8) public deviceCount;
    mapping(address => Proposal) private _proposal;

    event DeviceAdded(address indexed account, uint8 indexed slot, bytes32 indexed keyHash, bool approved);
    event DeviceRemoved(address indexed account, uint8 indexed slot, bytes32 indexed keyHash);
    event DeviceProposed(address indexed account, bytes32 indexed keyHash, uint64 dueAt);
    event ProposalCancelled(address indexed account, bytes32 indexed keyHash);

    error NoChainPqKey();
    error BadKeyLength();
    error HasDevices();
    error NoDevices();
    error TooManyDevices();
    error KeyInUse();
    error BadSlot();
    error ProposalPending();
    error NoProposal();
    error ProposalNotDue();

    constructor(string memory nativeChainId_) PqAuth(keccak256("QROW_KEYS_V3"), nativeChainId_, address(0)) {}

    // ================================================================== views (IQrowKeys)

    function deviceKey(address account, uint8 slot) public view returns (bytes memory) {
        return _device[account][slot];
    }

    function hasDevice(address account) external view returns (bool) {
        return deviceCount[account] != 0;
    }

    /// @notice All slots in use, with each key's hash (for the app's device list).
    function devices(address account) external view returns (uint8[] memory slots, bytes32[] memory keyHashes) {
        uint8 n = deviceCount[account];
        slots = new uint8[](n);
        keyHashes = new bytes32[](n);
        uint8 k;
        for (uint8 s = 0; s < MAX_DEVICES && k < n; s++) {
            bytes storage key = _device[account][s];
            if (key.length != 0) {
                slots[k] = s;
                keyHashes[k] = keccak256(key);
                k++;
            }
        }
    }

    function proposal(address account) external view returns (bytes32 keyHash, uint64 dueAt) {
        Proposal storage p = _proposal[account];
        return (p.pubkey.length == 0 ? bytes32(0) : keccak256(p.pubkey), p.dueAt);
    }

    // ================================================================== adding devices

    /// @notice First device: instant. `pop` is the new key's signature over this registration.
    function addFirstDevice(bytes calldata pubkey, uint64 validUntil, bytes calldata pop)
        external
        returns (uint8 slot)
    {
        if (deviceCount[msg.sender] != 0) revert HasDevices();
        if (QorePQC.provenKey(msg.sender).length == 0) revert NoChainPqKey();
        _checkNewKey(pubkey, validUntil, pop);
        slot = _store(msg.sender, pubkey);
        emit DeviceAdded(msg.sender, slot, keccak256(pubkey), false);
    }

    /// @notice Another device, approved by an existing one (`approverSig` = slot byte || signature
    ///         over ACTION_APPROVE_DEVICE and the new key's hash). Instant.
    function addApprovedDevice(bytes calldata pubkey, uint64 validUntil, bytes calldata pop, bytes calldata approverSig)
        external
        returns (uint8 slot)
    {
        if (deviceCount[msg.sender] == 0) revert NoDevices();
        _checkNewKey(pubkey, validUntil, pop);
        _requireDeviceSig(msg.sender, ACTION_APPROVE_DEVICE, keccak256(pubkey), validUntil, approverSig);
        slot = _store(msg.sender, pubkey);
        emit DeviceAdded(msg.sender, slot, keccak256(pubkey), true);
    }

    /// @notice Another device without an approving device: it can be finished after PROPOSAL_DELAY.
    function proposeDevice(bytes calldata pubkey, uint64 validUntil, bytes calldata pop) external {
        if (deviceCount[msg.sender] == 0) revert NoDevices();
        if (_proposal[msg.sender].pubkey.length != 0) revert ProposalPending();
        _checkNewKey(pubkey, validUntil, pop);
        uint64 due = uint64(block.timestamp) + PROPOSAL_DELAY;
        _proposal[msg.sender] = Proposal(pubkey, due);
        emit DeviceProposed(msg.sender, keccak256(pubkey), due);
    }

    /// @notice Finish a proposal after the delay.
    function finishProposal() external returns (uint8 slot) {
        Proposal memory p = _proposal[msg.sender];
        if (p.pubkey.length == 0) revert NoProposal();
        if (block.timestamp < p.dueAt) revert ProposalNotDue();
        delete _proposal[msg.sender];
        slot = _store(msg.sender, p.pubkey);
        emit DeviceAdded(msg.sender, slot, keccak256(p.pubkey), false);
    }

    /// @notice Cancel a pending proposal (the account, through QoreX).
    function cancelProposal() external {
        Proposal storage p = _proposal[msg.sender];
        if (p.pubkey.length == 0) revert NoProposal();
        bytes32 h = keccak256(p.pubkey);
        delete _proposal[msg.sender];
        emit ProposalCancelled(msg.sender, h);
    }

    /// @notice Remove a device (lost or replaced). The account decides, through QoreX.
    function removeDevice(uint8 slot) external {
        bytes memory key = _device[msg.sender][slot];
        if (key.length == 0) revert BadSlot();
        delete _device[msg.sender][slot];
        deviceCount[msg.sender] -= 1;
        emit DeviceRemoved(msg.sender, slot, keccak256(key));
    }

    // ================================================================== internals

    /// @dev The new key proves possession by signing ACTION_ADD_DEVICE over its own hash.
    function _checkNewKey(bytes calldata pubkey, uint64 validUntil, bytes calldata pop) private {
        if (pubkey.length != QorePQC.ML_DSA_87_PUBKEY_LEN) revert BadKeyLength();
        _requirePqWith(pubkey, msg.sender, ACTION_ADD_DEVICE, keccak256(pubkey), validUntil, pop);
    }

    function _store(address account, bytes memory pubkey) private returns (uint8) {
        bytes32 h = keccak256(pubkey);
        uint8 free = MAX_DEVICES;
        for (uint8 s = 0; s < MAX_DEVICES; s++) {
            bytes storage k = _device[account][s];
            if (k.length == 0) {
                if (free == MAX_DEVICES) free = s;
            } else if (keccak256(k) == h) {
                revert KeyInUse();
            }
        }
        if (free == MAX_DEVICES) revert TooManyDevices();
        _device[account][free] = pubkey;
        deviceCount[account] += 1;
        return free;
    }

    function _requireDeviceSig(address account, bytes32 action, bytes32 params, uint64 validUntil, bytes calldata sig)
        private
    {
        if (sig.length != QorePQC.ML_DSA_87_SIG_LEN + 1) revert BadPqSignature();
        bytes memory key = _device[account][uint8(sig[0])];
        if (key.length == 0) revert NoPqKey();
        _requirePqWith(key, account, action, params, validUntil, sig[1:]);
    }
}
