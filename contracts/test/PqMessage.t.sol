// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {QrowEscrow} from "../src/QrowEscrow.sol";

/// @notice The bytes the ML-DSA-87 key signs must be QoreSign's message format:
///         "qorechain-msg-v1|" + nativeChainId + "|" + "0x" + lowercase hex(digest).
contract PqMessageTest is Base {
    function test_MessageFormatIsQoreSign() public view {
        bytes32 d = 0x00112233445566778899aabbccddeeff0123456789abcdef00ff10a0b0c0d0e0;
        assertEq(
            escrow.pqMessage(d),
            bytes("qorechain-msg-v1|qorechain-diana|0x00112233445566778899aabbccddeeff0123456789abcdef00ff10a0b0c0d0e0")
        );
        assertEq(escrow.nativeChainId(), "qorechain-diana");
    }

    function testFuzz_MessageHexRoundTrip(bytes32 d) public view {
        bytes memory m = escrow.pqMessage(d);
        assertEq(m.length, 17 + 15 + 1 + 66); // prefix, chain id, "|", "0x"+64
        assertEq(keccak256(m), keccak256(abi.encodePacked("qorechain-msg-v1|qorechain-diana|", vm.toString(d))));
    }

    function test_RevertWhen_SignedRawDigest() public {
        // A signature over the bare 32-byte digest (no QoreSign domain) is not accepted.
        uint256 id = _createNative(ONE);
        uint64 v = _validUntil();
        bytes32 digest = escrow.actionDigest(escrow.ACTION_CLAIM(), bob, escrow.pqNonce(bob), v, _idParams(id));
        bytes memory sig = new bytes(4627);
        sig[0] = 0x77;
        verifier.record(_pubkey(bob), sig, abi.encodePacked(digest));
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.claim(id, v, sig);
    }

    function test_RevertWhen_SignedForOtherNativeChain() public {
        // Same digest, but the message names mainnet: rejected on a diana deployment.
        uint256 id = _createNative(ONE);
        uint64 v = _validUntil();
        bytes32 digest = escrow.actionDigest(escrow.ACTION_CLAIM(), bob, escrow.pqNonce(bob), v, _idParams(id));
        QrowEscrow mainnetStyle = new QrowEscrow("qorechain-vladi");
        bytes memory sig = new bytes(4627);
        sig[0] = 0x55;
        verifier.record(_pubkey(bob), sig, mainnetStyle.pqMessage(digest));
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.claim(id, v, sig);
    }

    function test_RevertWhen_BadNativeChainId() public {
        vm.expectRevert(QrowEscrow.InvalidChainId.selector);
        new QrowEscrow("");
        vm.expectRevert(QrowEscrow.InvalidChainId.selector);
        new QrowEscrow("qorechain diana");
        vm.expectRevert(QrowEscrow.InvalidChainId.selector);
        new QrowEscrow("qorechain-diana|x");
    }
}
