// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stand-in for the PQC Key Status precompile (0x…0A02), etched in tests.
contract MockPQCKeyStatus {
    struct Entry {
        bool registered;
        uint8 alg;
        bytes pubkey;
        bool proven;
    }

    mapping(address => Entry) internal entries;

    function setKey(address account, bool registered, uint8 alg, bytes calldata pubkey, bool proven) external {
        entries[account] = Entry(registered, alg, pubkey, proven);
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool) {
        Entry storage e = entries[account];
        return (e.registered, e.alg, e.pubkey, e.proven);
    }
}

/// @notice Stand-in for the PQC Verify precompile (0x…0A01), etched in tests.
/// A signature is valid only if the test's key-holder helper recorded it for exactly this
/// (pubkey, signature, message). Code that does not hold the PQ key (the attacker in the tests)
/// never records anything, which models "cannot produce an ML-DSA-87 signature".
contract MockPQCVerify {
    mapping(bytes32 => bool) internal signed;

    function record(bytes calldata pubkey, bytes calldata signature, bytes calldata message) external {
        signed[keccak256(abi.encode(pubkey, signature, message))] = true;
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool)
    {
        return signed[keccak256(abi.encode(pubkey, signature, message))];
    }
}
