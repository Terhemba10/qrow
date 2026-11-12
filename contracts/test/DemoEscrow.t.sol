// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {QrowEscrowDemo} from "../src/QrowEscrowDemo.sol";
import {QrowEscrow} from "../src/QrowEscrow.sol";
import {QorePQC} from "../src/IQorePQC.sol";
import {MockPQCKeyStatus, MockPQCVerify} from "./mocks/MockPQC.sol";

/// @notice The demo escrow behaves like QrowEscrow but refunds after 10 minutes, and its
///         signatures can't be replayed on the real escrow (different domain tag).
contract DemoEscrowTest is Test {
    QrowEscrowDemo demo;
    QrowEscrow real;
    MockPQCKeyStatus keyStatus = MockPQCKeyStatus(QorePQC.PQC_KEY_STATUS);
    MockPQCVerify verifier = MockPQCVerify(QorePQC.PQC_VERIFY);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.etch(QorePQC.PQC_KEY_STATUS, type(MockPQCKeyStatus).runtimeCode);
        vm.etch(QorePQC.PQC_VERIFY, type(MockPQCVerify).runtimeCode);
        demo = new QrowEscrowDemo("qorechain-diana");
        real = new QrowEscrow("qorechain-diana");
        bytes memory pk = new bytes(2592);
        pk[0] = 0x01;
        keyStatus.setKey(alice, true, 1, pk, true);
        vm.deal(alice, 10 ether);
    }

    function _sig(bytes32 digest, bytes memory message) internal returns (bytes memory s) {
        s = new bytes(4627);
        s[0] = bytes1(digest[0]);
        s[1] = 0x42;
        bytes memory pk = new bytes(2592);
        pk[0] = 0x01;
        verifier.record(pk, s, message);
    }

    function _create() internal returns (uint256 id, bytes memory sig, uint64 v) {
        v = uint64(block.timestamp + 10 minutes);
        bytes32 params = keccak256(abi.encode(bob, address(0), 1 ether, uint8(0), keccak256("")));
        bytes32 d = demo.actionDigest(demo.ACTION_CREATE(), alice, demo.pqNonce(alice), v, params);
        sig = _sig(d, demo.pqMessage(d));
        vm.prank(alice);
        id = demo.createPayment{value: 1 ether}(bob, address(0), 1 ether, QrowEscrowDemo.Mode.Direct, "", v, sig);
    }

    function test_RefundAfterTenMinutes() public {
        (uint256 id,,) = _create();
        assertEq(demo.getPayment(id).deadline, block.timestamp + 10 minutes);
        vm.warp(block.timestamp + 10 minutes - 1);
        vm.expectRevert(QrowEscrowDemo.NotExpired.selector);
        demo.refundExpired(id);
        vm.warp(block.timestamp + 1);
        uint256 before = alice.balance;
        demo.refundExpired(id);
        assertEq(alice.balance, before + 1 ether);
        assertEq(uint8(demo.getPayment(id).status), uint8(QrowEscrowDemo.Status.Refunded));
    }

    function test_DemoSignatureIsUselessOnRealEscrow() public {
        (, bytes memory sig, uint64 v) = _create();
        assertTrue(demo.DOMAIN_TAG() != real.DOMAIN_TAG());
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        real.createPayment{value: 1 ether}(bob, address(0), 1 ether, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_RealEscrowStillSevenDays() public view {
        assertEq(real.REFUND_PERIOD(), 7 days);
        assertEq(demo.REFUND_PERIOD(), 10 minutes);
    }
}
