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

/// @notice Qrow device keys (QrowKeys v3): registration, approvals, delayed proposals, use by every
///         contract through the slot byte, the chain-key fallback, and Q-Day attacks.
contract DeviceKeysTest is Test {
    QrowKeys internal keys;
    QrowEscrow internal escrow;
    QrowCoinFactory internal factory;

    MockPQCKeyStatus internal keyStatus = MockPQCKeyStatus(QorePQC.PQC_KEY_STATUS);
    MockPQCVerify internal verifier = MockPQCVerify(QorePQC.PQC_VERIFY);

    address internal alice = makeAddr("alice"); // QoreX user
    address internal bob = makeAddr("bob");
    address internal noKey = makeAddr("noKey"); // never registered an ML-DSA key on chain

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

    /// @dev The holder of `pubkey` signs `digest` on contract `on` (the mock records it as valid).
    function _sign(bytes memory pubkey, address on, bytes32 digest) internal returns (bytes memory sig) {
        sig = new bytes(QorePQC.ML_DSA_87_SIG_LEN);
        bytes32 tag = keccak256(abi.encode("sig", pubkey, digest));
        for (uint256 i = 0; i < 32; i++) {
            sig[i] = tag[i];
        }
        verifier.record(pubkey, sig, PqAuth(on).pqMessage(digest));
    }

    function _vu() internal view returns (uint64) {
        return uint64(block.timestamp + 10 minutes);
    }

    function _digest(address on, bytes32 action, address who, bytes32 params, uint64 vu, uint256 nonceOffset)
        internal
        view
        returns (bytes32)
    {
        return PqAuth(on).actionDigest(action, who, PqAuth(on).pqNonce(who) + nonceOffset, vu, params);
    }

    function _pop(bytes memory pk, address who, uint64 vu, uint256 nonceOffset) internal returns (bytes memory) {
        return
            _sign(
                pk, address(keys), _digest(address(keys), keys.ACTION_ADD_DEVICE(), who, keccak256(pk), vu, nonceOffset)
            );
    }

    function _first(address who, bytes memory pk) internal returns (uint8 slot) {
        uint64 vu = _vu();
        bytes memory pop = _pop(pk, who, vu, 0);
        vm.prank(who);
        slot = keys.addFirstDevice(pk, vu, pop);
    }

    /// @dev A device-key signature on the escrow's create action: slot byte || ML-DSA signature.
    function _escrowDeviceSig(bytes memory pk, uint8 slot, address who, uint256 amount)
        internal
        returns (uint64 vu, bytes memory sig)
    {
        vu = _vu();
        bytes32 params = keccak256(abi.encode(bob, address(0), amount, uint8(0), keccak256("")));
        bytes32 digest = escrow.actionDigest(escrow.ACTION_CREATE(), who, escrow.pqNonce(who), vu, params);
        sig = abi.encodePacked(slot, _sign(pk, address(escrow), digest));
    }

    function _create(address who, uint256 amount, uint64 vu, bytes memory sig) internal returns (uint256) {
        vm.prank(who);
        return escrow.createPayment{value: amount}(bob, address(0), amount, QrowEscrow.Mode(0), "", vu, sig);
    }

    // ---------------------------------------------------------------- registration and use

    function test_firstDeviceThenEscrowUsesIt() public {
        bytes memory dev = _key("laptop", alice);
        uint8 slot = _first(alice, dev);
        assertEq(slot, 0);
        assertEq(keys.deviceCount(alice), 1);
        assertTrue(escrow.hasPqKey(alice));
        (uint64 vu, bytes memory sig) = _escrowDeviceSig(dev, slot, alice, 1 ether);
        assertEq(sig.length, QorePQC.ML_DSA_87_SIG_LEN + 1);
        assertEq(_create(alice, 1 ether, vu, sig), 1);
    }

    function test_chainKeySignatureStillWorks() public {
        _first(alice, _key("laptop", alice));
        uint64 vu = _vu();
        bytes32 params = keccak256(abi.encode(bob, address(0), uint256(1 ether), uint8(0), keccak256("")));
        bytes memory sig = _sign(
            _key("chain", alice), address(escrow), escrow.actionDigest(escrow.ACTION_CREATE(), alice, 0, vu, params)
        );
        assertEq(_create(alice, 1 ether, vu, sig), 1);
    }

    function test_wrongSlotOrEmptySlotFails() public {
        bytes memory dev = _key("laptop", alice);
        _first(alice, dev);
        (uint64 vu, bytes memory sig) = _escrowDeviceSig(dev, 3, alice, 1 ether); // slot 3 is empty
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.NoPqKey.selector);
        escrow.createPayment{value: 1 ether}(bob, address(0), 1 ether, QrowEscrow.Mode(0), "", vu, sig);
    }

    function test_firstDeviceNeedsChainKeyAndPop() public {
        bytes memory pk = _key("dev", noKey);
        uint64 vu = _vu();
        bytes memory pop = _pop(pk, noKey, vu, 0);
        vm.prank(noKey);
        vm.expectRevert(QrowKeys.NoChainPqKey.selector);
        keys.addFirstDevice(pk, vu, pop);

        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        keys.addFirstDevice(_key("dev", alice), vu, new bytes(QorePQC.ML_DSA_87_SIG_LEN));

        vm.prank(alice);
        vm.expectRevert(QrowKeys.BadKeyLength.selector);
        keys.addFirstDevice(new bytes(32), vu, new bytes(0));
    }

    function test_firstDeviceOnlyOnce() public {
        _first(alice, _key("laptop", alice));
        bytes memory pk = _key("phone", alice);
        uint64 vu = _vu();
        bytes memory pop = _pop(pk, alice, vu, 0);
        vm.prank(alice);
        vm.expectRevert(QrowKeys.HasDevices.selector);
        keys.addFirstDevice(pk, vu, pop);
    }

    function test_popNotReplayableByAnotherAccount() public {
        bytes memory pk = _key("dev", alice);
        uint64 vu = _vu();
        bytes memory pop = _pop(pk, alice, vu, 0);
        vm.prank(bob);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        keys.addFirstDevice(pk, vu, pop);
    }

    // ---------------------------------------------------------------- more devices

    function test_approvedDeviceIsInstant() public {
        bytes memory laptop = _key("laptop", alice);
        _first(alice, laptop);
        bytes memory phone = _key("phone", alice);
        uint64 vu = _vu();
        bytes memory pop = _pop(phone, alice, vu, 0); // nonce n: the new key's proof
        bytes memory approve = abi.encodePacked(
            uint8(0),
            _sign(
                laptop,
                address(keys),
                _digest(address(keys), keys.ACTION_APPROVE_DEVICE(), alice, keccak256(phone), vu, 1)
            )
        );
        vm.prank(alice);
        uint8 slot = keys.addApprovedDevice(phone, vu, pop, approve);
        assertEq(slot, 1);
        assertEq(keys.deviceCount(alice), 2);
        (uint64 vu2, bytes memory sig) = _escrowDeviceSig(phone, 1, alice, 1 ether);
        assertEq(_create(alice, 1 ether, vu2, sig), 1);
    }

    function test_proposalWaitsThreeDaysAndCanBeCancelled() public {
        _first(alice, _key("laptop", alice));
        bytes memory phone = _key("phone", alice);
        uint64 vu = _vu();
        bytes memory pop = _pop(phone, alice, vu, 0);
        vm.prank(alice);
        keys.proposeDevice(phone, vu, pop);
        (bytes32 h, uint64 due) = keys.proposal(alice);
        assertEq(h, keccak256(phone));
        assertEq(due, block.timestamp + 3 days);

        vm.prank(alice);
        vm.expectRevert(QrowKeys.ProposalNotDue.selector);
        keys.finishProposal();

        vm.prank(alice);
        keys.cancelProposal();
        vm.warp(block.timestamp + 4 days);
        vm.prank(alice);
        vm.expectRevert(QrowKeys.NoProposal.selector);
        keys.finishProposal();
        assertEq(keys.deviceCount(alice), 1);
    }

    function test_proposalFinishesAfterDelay() public {
        _first(alice, _key("laptop", alice));
        bytes memory phone = _key("phone", alice);
        uint64 vu = _vu();
        bytes memory pop = _pop(phone, alice, vu, 0);
        vm.prank(alice);
        keys.proposeDevice(phone, vu, pop);
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        uint8 slot = keys.finishProposal();
        assertEq(keccak256(keys.deviceKey(alice, slot)), keccak256(phone));
    }

    function test_removeDeviceAndLimits() public {
        bytes memory laptop = _key("laptop", alice);
        _first(alice, laptop);
        vm.prank(alice);
        keys.removeDevice(0);
        assertEq(keys.deviceCount(alice), 0);
        assertFalse(keys.hasDevice(alice));
        assertTrue(escrow.hasPqKey(alice)); // the chain key still counts
        vm.prank(alice);
        vm.expectRevert(QrowKeys.BadSlot.selector);
        keys.removeDevice(0);
        _first(alice, laptop); // can start again
        (uint8[] memory slots,) = keys.devices(alice);
        assertEq(slots.length, 1);
    }

    function test_sameKeyCannotBeAddedTwice() public {
        bytes memory laptop = _key("laptop", alice);
        _first(alice, laptop);
        uint64 vu = _vu();
        bytes memory pop = _pop(laptop, alice, vu, 0);
        vm.prank(alice);
        keys.proposeDevice(laptop, vu, pop);
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        vm.expectRevert(QrowKeys.KeyInUse.selector);
        keys.finishProposal();
    }

    // ---------------------------------------------------------------- Q-Day: the attacker has alice's secp256k1 key only

    /// Without the ML-DSA key the attacker can't reach msg.sender == alice on QoreChain at all (no
    /// window, no native signature). These tests assume the worst case anyway: an attacker who could.
    function test_qday_cannotApproveWithoutADeviceKey() public {
        _first(alice, _key("laptop", alice));
        bytes memory evil = _key("evil", alice);
        uint64 vu = _vu();
        bytes memory pop = _pop(evil, alice, vu, 0);
        bytes memory forged = abi.encodePacked(uint8(0), new bytes(QorePQC.ML_DSA_87_SIG_LEN));
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        keys.addApprovedDevice(evil, vu, pop, forged);
        assertEq(keys.deviceCount(alice), 1);
    }

    function test_qday_cannotSignActionsWithoutADeviceKey() public {
        _first(alice, _key("laptop", alice));
        (uint64 vu, bytes memory sig) = _escrowDeviceSig(_key("evil", alice), 0, alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: 1 ether}(bob, address(0), 1 ether, QrowEscrow.Mode(0), "", vu, sig);
    }

    // ---------------------------------------------------------------- launched coins inherit the registry

    function test_launchAndClaimWithDeviceKey() public {
        bytes memory dev = _key("laptop", alice);
        uint8 slot = _first(alice, dev);
        string memory desc = "";
        bytes32 params = keccak256(
            abi.encode(
                keccak256("Paper Lantern"), keccak256("LANT"), uint256(1_000_000), uint16(500), keccak256(bytes(desc))
            )
        );
        uint64 vu = _vu();
        bytes memory sig = abi.encodePacked(
            slot, _sign(dev, address(factory), _digest(address(factory), factory.ACTION_LAUNCH(), alice, params, vu, 0))
        );
        vm.prank(alice);
        address coin = factory.launch("Paper Lantern", "LANT", 1_000_000, 500, desc, vu, sig);
        assertEq(address(QrowCoin(coin).KEYS()), address(keys));

        bytes memory claimSig = abi.encodePacked(
            slot,
            _sign(dev, coin, _digest(coin, QrowCoin(coin).ACTION_CLAIM(), alice, keccak256(abi.encode(coin)), vu, 0))
        );
        vm.prank(alice);
        assertGt(QrowCoin(coin).claim(vu, claimSig), 0);
    }
}
