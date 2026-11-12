// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {PqAuth} from "../src/PqAuth.sol";

/// @notice Signing helpers for any PqAuth contract (Genesis, Market, Factory, Coin).
abstract contract PqBase is Base {
    function _pqSig(PqAuth c, address who, bytes32 action, bytes32 params, uint64 validUntil)
        internal
        returns (bytes memory sig)
    {
        bytes32 digest = c.actionDigest(action, who, c.pqNonce(who), validUntil, params);
        sig = new bytes(4627);
        bytes32 tag = keccak256(abi.encode("sig", who, digest, address(c)));
        for (uint256 i = 0; i < 32; i++) sig[i] = tag[i];
        verifier.record(_pubkey(who), sig, c.pqMessage(digest));
    }

    function _forgedSig() internal pure returns (bytes memory s) {
        s = new bytes(4627);
        s[0] = 0x66;
    }
}
