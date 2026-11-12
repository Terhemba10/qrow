// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QrowKeys} from "../src/QrowKeys.sol";
import {QrowEscrow} from "../src/QrowEscrow.sol";
import {QrowCoinFactory} from "../src/QrowCoinFactory.sol";
import {QrowCoin} from "../src/QrowCoin.sol";
import {PqAuth} from "../src/PqAuth.sol";
import {QorePQC} from "../src/IQorePQC.sol";
import {MockPQCKeyStatus, MockPQCVerify} from "./mocks/MockPQC.sol";

/// @notice The Qrow app key: registration safeguards, use by every contract, and Q-Day attacks.
contract AppKeyTest is Test {
    QrowKeys internal keys;
    QrowEscrow internal escrow;
    QrowCoinFactory internal factory;

    MockPQCKeyStatus internal keyStatus = MockPQCKeyStatus(QorePQC.PQC_KEY_STATUS);
    MockPQCVerify internal verifier = MockPQCVerify(QorePQC.PQC_VERIFY);

    address internal alice = makeAddr("alice"); // QoreX user: chain key held by QoreX, app key held by Qrow
    address internal bob = makeAddr("bob");
    address internal noKey = makeAddr("noKey"); // never registered an ML-DSA key on chain

    uint8 internal constant DIRECT = 0;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.etch(QorePQC.PQC_KEY_STATUS, type(MockPQCKeyStatus).runtimeCode);
        vm.etch(QorePQC.PQC_VERIFY, type(MockPQCVerify).runtimeCode);
        keys = new QrowKeys("qorechain-diana");
        escrow = new QrowEscrow("qorechain-diana", address(keys));
        factory = new QrowCoinFactory("qorechain-diana", address(keys));
        keyStatus.setKey(alice, true, QorePQC.ALG_ML_DSA_87, _key("chain", alice), true);
        keyStatus.setKey(bob, true, QorePQC.ALG_ML_DSA_87, _key("chain", bob), true);
        vm.deal(alice, 100 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _key(string memory kind, address who) internal pure returns (bytes memory pk) {
        pk = new bytes(QorePQC.ML_DSA_87_PUBKEY_LEN);
        bytes32 seed = keccak256(abi.encode(kind, who));
        for (uint256 i = 0; i < 32; i++) {
            pk[i] = seed[i];
        }
    }

    /// @dev The holder of `pubkey` signs `digest` (the mock verifier records it as valid).
    function _sign(bytes memory pubkey, PqAuth on, bytes32 digest) internal returns (bytes memory sig) {
        sig = new bytes(QorePQC.ML_DSA_87_SIG_LEN);
        bytes32 tag = keccak256(abi.encode("sig", pubkey, digest));
        for (uint256 i = 0; i < 32; i++) {
            sig[i] = tag[i];
        }
        verifier.record(pubkey, sig, on.pqMessage(digest));
    }

    function _vu() internal view returns (uint64) {
        return uint64(block.timestamp + 10 minutes);
    }

    function _sigOn(
        bytes memory pubkey,
        PqAuth on,
        bytes32 action,
        address who,
        bytes32 params,
        uint64 vu,
        uint256 nonceOffset
    ) internal returns (bytes memory) {
        return _sign(pubkey, on, on.actionDigest(action, who, on.pqNonce(who) + nonceOffset, vu, params));
    }

    function _register(address who, bytes memory pk) internal {
        uint64 vu = _vu();
        bytes memory pop = _sigOn(pk, keys, keys.ACTION_REGISTER(), who, keccak256(pk), vu, 0);
        vm.prank(who);
        keys.register(pk, vu, pop);
    }

    function _escrowSig(bytes memory pk, address who, uint256 amount) internal returns (uint64 vu, bytes memory sig) {
        vu = _vu();
        bytes32 params = keccak256(abi.encode(bob, address(0), amount, DIRECT, keccak256("")));
        bytes32 digest = escrow.actionDigest(escrow.ACTION_CREATE(), who, escrow.pqNonce(who), vu, params);
        sig = new bytes(QorePQC.ML_DSA_87_SIG_LEN);
        bytes32 tag = keccak256(abi.encode("sig", pk, digest));
        for (uint256 i = 0; i < 32; i++) {
            sig[i] = tag[i];
        }
        verifier.record(pk, sig, escrow.pqMessage(digest));
    }

    // ---------------------------------------------------------------- registration

    function test_registerThenEscrowUsesAppKey() public {
        bytes memory app = _key("app", alice);
        _register(alice, app);
        assertTrue(keys.hasAppKey(alice));
        assertEq(keccak256(keys.keyOf(alice)), keccak256(app));

        (uint64 vu, bytes memory sig) = _escrowSig(app, alice, 1 ether);
        vm.prank(alice);
        uint256 id =
            escrow.createPayment{value: 1 ether}(bob, address(0), 1 ether, QrowEscrow.Mode(DIRECT), "", vu, sig);
        assertEq(id, 1);
    }

    function test_chainKeyNoLongerAcceptedOnceAppKeySet() public {
        _register(alice, _key("app", alice));
        (uint64 vu, bytes memory sig) = _escrowSig(_key("chain", alice), alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: 1 ether}(bob, address(0), 1 ether, QrowEscrow.Mode(DIRECT), "", vu, sig);
    }

    function test_withoutAppKeyFallsBackToChainKey() public {
        (uint64 vu, bytes memory sig) = _escrowSig(_key("chain", alice), alice, 1 ether);
        vm.prank(alice);
        escrow.createPayment{value: 1 ether}(bob, address(0), 1 ether, QrowEscrow.Mode(DIRECT), "", vu, sig);
        assertTrue(escrow.hasPqKey(alice));
        assertFalse(escrow.hasPqKey(noKey));
    }

    function test_registerNeedsChainKey() public {
        bytes memory pk = _key("app", noKey);
        uint64 vu = _vu();
        bytes memory pop = _sigOn(pk, keys, keys.ACTION_REGISTER(), noKey, keccak256(pk), vu, 0);
        vm.prank(noKey);
        vm.expectRevert(QrowKeys.NoChainPqKey.selector);
        keys.register(pk, vu, pop);
    }

    function test_registerNeedsProofOfPossession() public {
        bytes memory pk = _key("app", alice);
        bytes memory fake = new bytes(QorePQC.ML_DSA_87_SIG_LEN); // nobody signed it
        uint64 vu = _vu();
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        keys.register(pk, vu, fake);
    }

    function test_registerRejectsBadLengthAndSecondKey() public {
        vm.prank(alice);
        vm.expectRevert(QrowKeys.BadKeyLength.selector);
        keys.register(new bytes(32), _vu(), new bytes(0));

        _register(alice, _key("app", alice));
        bytes memory other = _key("other", alice);
        uint64 vu = _vu();
        bytes memory pop = _sigOn(other, keys, keys.ACTION_REGISTER(), alice, keccak256(other), vu, 0);
        vm.prank(alice);
        vm.expectRevert(QrowKeys.AlreadyRegistered.selector);
        keys.register(other, vu, pop);
    }

    /// A registration signed for alice can't be replayed by anyone else (signer is bound into the digest).
    function test_registrationSignatureNotReplayableByOthers() public {
        bytes memory pk = _key("app", alice);
        uint64 vu = _vu();
        bytes memory pop = _sigOn(pk, keys, keys.ACTION_REGISTER(), alice, keccak256(pk), vu, 0);
        vm.prank(bob);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        keys.register(pk, vu, pop);
    }

    // ---------------------------------------------------------------- rotate / revoke

    function test_rotateNeedsOldAndNewKey() public {
        bytes memory oldK = _key("app", alice);
        bytes memory newK = _key("app2", alice);
        _register(alice, oldK);
        uint64 vu = _vu();
        bytes32 h = keccak256(newK);
        bytes memory sigOld = _sigOn(oldK, keys, keys.ACTION_ROTATE(), alice, h, vu, 0);
        bytes memory pop = _sigOn(newK, keys, keys.ACTION_REGISTER(), alice, h, vu, 1);
        vm.prank(alice);
        keys.rotate(newK, vu, sigOld, pop);
        assertEq(keccak256(keys.keyOf(alice)), h);
    }

    function test_revokeFallsBackToChainKey() public {
        bytes memory app = _key("app", alice);
        _register(alice, app);
        uint64 vu = _vu();
        bytes memory sig = _sigOn(app, keys, keys.ACTION_REVOKE(), alice, bytes32(0), vu, 0);
        vm.prank(alice);
        keys.revoke(vu, sig);
        assertFalse(keys.hasAppKey(alice));
        assertEq(keccak256(keys.keyOf(alice)), keccak256(_key("chain", alice)));
    }

    // ---------------------------------------------------------------- Q-Day: attacker holds alice's secp256k1 key only

    function test_qday_cannotRotateOrRevokeWithoutAppKey() public {
        _register(alice, _key("app", alice));
        bytes memory evil = _key("evil", alice);
        uint64 vu = _vu();
        bytes memory evilPop = _sigOn(evil, keys, keys.ACTION_REGISTER(), alice, keccak256(evil), vu, 1);
        bytes memory forged = new bytes(QorePQC.ML_DSA_87_SIG_LEN);
        vm.startPrank(alice); // the attacker sends as alice
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        keys.rotate(evil, vu, forged, evilPop);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        keys.revoke(vu, forged);
        vm.stopPrank();
        assertEq(keccak256(keys.keyOf(alice)), keccak256(_key("app", alice)));
    }

    function test_qday_resetWaitsAndOwnerCancels() public {
        bytes memory app = _key("app", alice);
        _register(alice, app);
        vm.prank(alice); // attacker starts a reset
        keys.requestReset();
        vm.prank(alice);
        vm.expectRevert(QrowKeys.ResetNotDue.selector);
        keys.finishReset();
        vm.prank(alice);
        vm.expectRevert(QrowKeys.ResetPending.selector);
        keys.requestReset();

        // The real owner (holding the app key) cancels within the delay.
        uint64 vu = _vu();
        bytes memory sig = _sigOn(app, keys, keys.ACTION_CANCEL_RESET(), alice, bytes32(0), vu, 0);
        vm.prank(alice);
        keys.cancelReset(vu, sig);
        assertEq(keys.resetAt(alice), 0);
        vm.warp(block.timestamp + 4 days);
        vm.prank(alice);
        vm.expectRevert(QrowKeys.NoResetPending.selector);
        keys.finishReset();
        assertTrue(keys.hasAppKey(alice));
    }

    function test_lostCodeResetAfterDelay() public {
        _register(alice, _key("app", alice));
        vm.prank(alice);
        keys.requestReset();
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        keys.finishReset();
        assertFalse(keys.hasAppKey(alice));
        _register(alice, _key("app2", alice)); // a fresh key can be registered
        assertEq(keccak256(keys.keyOf(alice)), keccak256(_key("app2", alice)));
    }

    function test_qday_cannotCancelResetWithoutAppKey() public {
        _register(alice, _key("app", alice));
        vm.prank(alice);
        keys.requestReset();
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        keys.cancelReset(_vu(), new bytes(QorePQC.ML_DSA_87_SIG_LEN));
    }

    // ---------------------------------------------------------------- launched coins inherit the registry

    function test_launchedCoinClaimUsesAppKey() public {
        bytes memory app = _key("app", alice);
        _register(alice, app);
        string memory desc = "";
        bytes32 params = keccak256(
            abi.encode(
                keccak256("Paper Lantern"), keccak256("LANT"), uint256(1_000_000), uint16(500), keccak256(bytes(desc))
            )
        );
        uint64 vu = _vu();
        bytes memory sig = _sigOn(app, factory, factory.ACTION_LAUNCH(), alice, params, vu, 0);
        vm.prank(alice);
        address coin = factory.launch("Paper Lantern", "LANT", 1_000_000, 500, desc, vu, sig);
        assertEq(address(QrowCoin(coin).KEYS()), address(keys));

        bytes memory claimSig =
            _sigOn(app, QrowCoin(coin), QrowCoin(coin).ACTION_CLAIM(), alice, keccak256(abi.encode(coin)), vu, 0);
        vm.prank(alice);
        uint256 got = QrowCoin(coin).claim(vu, claimSig);
        assertGt(got, 0);
    }
}
