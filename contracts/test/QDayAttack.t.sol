// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {QrowEscrow} from "../src/QrowEscrow.sol";
import {ReentrantToken, RejectingSender, ReentrantRecipient} from "./mocks/Tokens.sol";

/// @notice Q-Day Drill model: the attacker has recovered the victim's secp256k1 (ECDSA) key, so
///         `vm.prank(victim)` is available to them, and assume the chain even admits their EVM
///         transactions (worst case: an open EVM window). They do NOT hold the victim's ML-DSA-87
///         key, so they cannot get the verify precompile to accept a new signature.
contract QDayLeakedEcdsaTest is Base {
    uint256 internal aliceId; // alice -> bob, pending
    uint256 internal toAliceId; // carol -> alice, pending (alice is recipient)
    uint256 internal freelanceId; // alice -> bob, freelancer

    function setUp() public override {
        super.setUp();
        aliceId = _createNative(10 ether);
        fusd.mint(carol, 100 ether);
        vm.prank(carol);
        fusd.approve(address(escrow), type(uint256).max);
        toAliceId = _create(carol, alice, address(fusd), 20 ether, DIRECT);
        freelanceId = _create(alice, bob, address(0), 4 ether, FREELANCER);
    }

    function _forged() internal pure returns (bytes memory s) {
        s = new bytes(4627);
        s[0] = 0x42;
    }

    function test_Attack_CannotCreatePaymentToSelf() public {
        vm.prank(alice); // ECDSA key leaked
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: 100 ether}(
            mallory, address(0), 100 ether, QrowEscrow.Mode.Direct, "", _validUntil(), _forged()
        );
    }

    function test_Attack_CannotDrainApprovedTokensViaCreate() public {
        // Alice approved the escrow for max fUSD. The attacker tries to pull it into a payment to them.
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment(mallory, address(fusd), 1_000 ether, QrowEscrow.Mode.Direct, "", _validUntil(), _forged());
        assertEq(fusd.balanceOf(alice), 1_000 ether);
    }

    function test_Attack_CannotCancel() public {
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.cancel(aliceId, _validUntil(), _forged());
    }

    function test_Attack_CannotClaimAsRecipient() public {
        vm.prank(alice); // alice's ECDSA key, alice is the recipient of toAliceId
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.claim(toAliceId, _validUntil(), _forged());
    }

    function test_Attack_CannotRelease() public {
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.release(freelanceId, _validUntil(), _forged());
    }

    function test_Attack_CannotChangeLimits() public {
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.setLimits(address(0), 0, 0, _validUntil(), _forged());
    }

    function test_Attack_CannotReplayObservedSignature() public {
        // The attacker watched alice's earlier createPayment and copies its PQ signature.
        uint64 v = _validUntil();
        bytes memory sig =
            _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        vm.prank(alice);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);

        // Same params replayed: nonce already consumed.
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
        // Redirected to the attacker: params bound in the digest.
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: ONE}(mallory, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_Attack_FrontRunningAValidSignatureGivesSameOutcome() public {
        // Attacker sees alice's signed cancel in the mempool and submits it first from alice's
        // address. The result is exactly what alice signed: funds back to alice.
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CANCEL(), _idParams(aliceId), v);
        uint256 before = alice.balance;
        vm.prank(alice); // submitted by the attacker holding alice's ECDSA key
        escrow.cancel(aliceId, v, sig);
        assertEq(alice.balance, before + 10 ether);
        assertEq(mallory.balance, 0);
    }

    function test_Attack_CannotUseOwnPqKeyForVictim() public {
        // Mallory has her own valid PQ key and signs as herself, but sends from alice's address.
        _registerKey(mallory);
        uint64 v = _validUntil();
        bytes32 digest = escrow.actionDigest(escrow.ACTION_CANCEL(), mallory, 0, v, _idParams(aliceId));
        bytes memory malSig = _signDigest(mallory, digest);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.cancel(aliceId, v, malSig);
        // And from her own address she is simply not the sender.
        vm.prank(mallory);
        vm.expectRevert(QrowEscrow.NotSender.selector);
        escrow.cancel(aliceId, v, malSig);
    }

    function test_Attack_RefundOnlyEverPaysSender() public {
        vm.warp(block.timestamp + 7 days);
        uint256 before = alice.balance;
        vm.prank(mallory);
        escrow.refundExpired(aliceId);
        assertEq(alice.balance, before + 10 ether);
        assertEq(mallory.balance, 0);
    }

    function test_Attack_EscrowHoldsEverythingAfterAllAttempts() public {
        uint256 nativeBefore = address(escrow).balance;
        uint256 fusdBefore = fusd.balanceOf(address(escrow));
        bytes memory f = _forged();
        uint64 v = _validUntil();

        vm.startPrank(alice);
        try escrow.cancel(aliceId, v, f) {} catch {}
        try escrow.release(freelanceId, v, f) {} catch {}
        try escrow.claim(toAliceId, v, f) {} catch {}
        try escrow.createPayment(mallory, address(fusd), 1_000 ether, QrowEscrow.Mode.Direct, "", v, f) {} catch {}
        vm.stopPrank();

        assertEq(address(escrow).balance, nativeBefore);
        assertEq(fusd.balanceOf(address(escrow)), fusdBefore);
        assertEq(uint8(_status(aliceId)), uint8(QrowEscrow.Status.Pending));
        assertEq(uint8(_status(freelanceId)), uint8(QrowEscrow.Status.Pending));
        assertEq(uint8(_status(toAliceId)), uint8(QrowEscrow.Status.Pending));
        assertEq(escrow.pqNonce(alice), 2); // two genuine creates in setUp, no attacker writes
    }
}

contract ReentrancyTest is Base {
    function test_ReentrantTokenCannotDoubleRefund() public {
        ReentrantToken rt = new ReentrantToken();
        rt.mint(alice, 100 ether);
        vm.prank(alice);
        rt.approve(address(escrow), type(uint256).max);
        uint256 id = _create(alice, bob, address(rt), 10 ether, DIRECT);
        uint256 id2 = _create(alice, bob, address(rt), 10 ether, DIRECT);

        vm.warp(block.timestamp + 7 days);
        rt.arm(address(escrow), id2); // on transfer() during refund of id, try to refund id2
        // The inner call hits the guard (Reentrancy), which makes the token transfer fail.
        vm.expectRevert(QrowEscrow.TransferFailed.selector);
        escrow.refundExpired(id);
        // State unchanged; a clean refund still works afterwards.
        assertEq(uint8(_status(id)), uint8(QrowEscrow.Status.Pending));
        rt.disarm();
        escrow.refundExpired(id);
        escrow.refundExpired(id2);
        assertEq(rt.balanceOf(alice), 100 ether);
    }

    function test_ReentrantRecipientCannotClaimTwice() public {
        ReentrantRecipient rr = new ReentrantRecipient();
        _registerKey(address(rr));
        uint256 id = _create(alice, address(rr), address(0), 2 ether, DIRECT);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(address(rr), escrow.ACTION_CLAIM(), _idParams(id), v);
        rr.prime(address(escrow), id, v, sig);
        // receive() re-enters claim → Reentrancy → native send fails → TransferFailed.
        vm.expectRevert(QrowEscrow.TransferFailed.selector);
        rr.doClaim();
        assertEq(address(escrow).balance, 2 ether);
    }

    function test_RefundToRejectingSenderIsCreditedNotStuck() public {
        RejectingSender rs = new RejectingSender();
        _registerKey(address(rs));
        vm.deal(address(rs), 5 ether);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(
            address(rs), escrow.ACTION_CREATE(), _createParams(bob, address(0), 5 ether, DIRECT, ""), v
        );
        rs.exec(
            address(escrow),
            5 ether,
            abi.encodeCall(QrowEscrow.createPayment, (bob, address(0), 5 ether, QrowEscrow.Mode.Direct, "", v, sig))
        );
        vm.warp(block.timestamp + 7 days);
        vm.prank(carol);
        escrow.refundExpired(1); // must not revert
        assertEq(uint8(_status(1)), uint8(QrowEscrow.Status.Refunded));
        assertEq(escrow.owedNative(address(rs)), 5 ether);

        // Once it accepts QOR again, it pulls the credit. Nobody else can.
        vm.prank(mallory);
        vm.expectRevert(QrowEscrow.NothingOwed.selector);
        escrow.withdrawOwed();
        rs.setAccept(true);
        rs.exec(address(escrow), 0, abi.encodeCall(QrowEscrow.withdrawOwed, ()));
        assertEq(address(rs).balance, 5 ether);
        assertEq(escrow.owedNative(address(rs)), 0);
    }

    function test_RevertWhen_WithdrawOwedNothing() public {
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.NothingOwed.selector);
        escrow.withdrawOwed();
    }
}
