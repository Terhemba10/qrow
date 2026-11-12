// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain post-quantum precompiles (testnet qorechain-diana, EVM chain id 9800).
/// Source: https://docs.qorechain.io/developer-guide/evm-precompiles
/// An inactive precompile address returns empty data (0x) instead of reverting,
/// so callers must check the return length and fail closed.
interface IQorePQC {
    /// @param pubkey    2,592-byte ML-DSA-87 public key
    /// @param signature 4,627-byte ML-DSA-87 signature
    /// @param message   the signed message bytes
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// @return registered       a PQC key is registered for `account`
    /// @return algorithmId      1 = ML-DSA-87
    /// @return pubkey           the registered public key (empty if none)
    /// @return possessionProven key was registered with a verified proof of possession
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

library QorePQC {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;
    uint8 internal constant ALG_ML_DSA_87 = 1;
    uint256 internal constant ML_DSA_87_PUBKEY_LEN = 2592;
    uint256 internal constant ML_DSA_87_SIG_LEN = 4627;

    /// @notice Returns the account's ML-DSA-87 public key if it is registered with proof of
    /// possession, or empty bytes otherwise. Never reverts on a missing/inactive precompile.
    function provenKey(address account) internal view returns (bytes memory) {
        (bool ok, bytes memory ret) =
            PQC_KEY_STATUS.staticcall(abi.encodeCall(IQorePQC.pqcKeyStatus, (account)));
        // 4 head words + the bytes length word = 160 bytes minimum for a well-formed answer.
        if (!ok || ret.length < 160) return "";
        (bool registered, uint8 alg, bytes memory pubkey, bool proven) =
            abi.decode(ret, (bool, uint8, bytes, bool));
        if (!registered || alg != ALG_ML_DSA_87 || !proven || pubkey.length != ML_DSA_87_PUBKEY_LEN) {
            return "";
        }
        return pubkey;
    }

    /// @notice True only if the precompile answers with an ABI-encoded `true`.
    function verify(bytes memory pubkey, bytes calldata signature, bytes memory message)
        internal
        view
        returns (bool)
    {
        if (signature.length != ML_DSA_87_SIG_LEN) return false;
        (bool ok, bytes memory ret) =
            PQC_VERIFY.staticcall(abi.encodeCall(IQorePQC.pqcVerify, (pubkey, signature, message)));
        if (!ok || ret.length != 32) return false;
        return abi.decode(ret, (bool));
    }
}
