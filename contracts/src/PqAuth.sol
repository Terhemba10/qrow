// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./IQorePQC.sol";

/// @title  PqAuth: post-quantum authorisation shared by Qrow's contracts (same scheme as QrowEscrow)
/// @notice A sensitive call must carry an ML-DSA-87 signature, made with the caller's key registered
///         on QoreChain, over QoreSign's message format:
///             "qorechain-msg-v1|" + nativeChainId + "|" + "0x" + hex(digest)
///         where digest binds the domain tag, EVM chain id, this contract, the action, the signer,
///         the signer's nonce, an expiry (at most 1 hour ahead) and a hash of the call's parameters.
///         A leaked secp256k1 key alone can therefore not authorise anything.
abstract contract PqAuth {
    uint64 public constant MAX_SIG_VALIDITY = 1 hours;
    bytes16 private constant HEX = "0123456789abcdef";

    /// @notice Per-contract domain tag, e.g. keccak256("QROW_MARKET_V1").
    bytes32 public immutable DOMAIN_TAG;
    /// @notice QoreChain native chain id this deployment signs for ("qorechain-diana").
    string public nativeChainId;
    bytes private _msgPrefix;

    mapping(address => uint256) public pqNonce;

    error InvalidChainId();
    error NoPqKey();
    error BadPqSignature();
    error SignatureExpired();
    error SignatureTooLong();

    constructor(bytes32 domainTag, string memory nativeChainId_) {
        bytes memory id = bytes(nativeChainId_);
        if (id.length == 0 || id.length > 64) revert InvalidChainId();
        for (uint256 i = 0; i < id.length; i++) {
            bytes1 c = id[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "." || c == "_"
                || c == "-";
            if (!ok) revert InvalidChainId();
        }
        DOMAIN_TAG = domainTag;
        nativeChainId = nativeChainId_;
        _msgPrefix = abi.encodePacked("qorechain-msg-v1|", nativeChainId_, "|");
    }

    function actionDigest(bytes32 action, address signer, uint256 nonce, uint64 validUntil, bytes32 paramsHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(DOMAIN_TAG, block.chainid, address(this), action, signer, nonce, validUntil, paramsHash));
    }

    /// @notice The exact bytes the ML-DSA-87 key signs for `digest`.
    function pqMessage(bytes32 digest) public view returns (bytes memory) {
        bytes memory hexStr = new bytes(66);
        hexStr[0] = "0";
        hexStr[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(digest[i]);
            hexStr[2 + 2 * i] = HEX[b >> 4];
            hexStr[3 + 2 * i] = HEX[b & 0x0f];
        }
        return abi.encodePacked(_msgPrefix, hexStr);
    }

    /// @notice Whether `account` has an ML-DSA-87 key registered with proof of possession.
    function hasPqKey(address account) public view returns (bool) {
        return QorePQC.provenKey(account).length != 0;
    }

    function _requirePq(address signer, bytes32 action, bytes32 paramsHash, uint64 validUntil, bytes calldata sig)
        internal
    {
        if (block.timestamp > validUntil) revert SignatureExpired();
        if (validUntil > block.timestamp + MAX_SIG_VALIDITY) revert SignatureTooLong();
        bytes memory pubkey = QorePQC.provenKey(signer);
        if (pubkey.length == 0) revert NoPqKey();
        uint256 nonce = pqNonce[signer];
        bytes32 digest = actionDigest(action, signer, nonce, validUntil, paramsHash);
        if (!QorePQC.verify(pubkey, sig, pqMessage(digest))) revert BadPqSignature();
        pqNonce[signer] = nonce + 1;
    }
}
