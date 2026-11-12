// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {QrowEscrow} from "../src/QrowEscrow.sol";
import {QorePQC} from "../src/IQorePQC.sol";
import {FeeOnTransferToken, FalseToken, MockERC20} from "./mocks/Tokens.sol";

contract CreateTest is Base {
    event PaymentCreated(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint64 deadline,
        QrowEscrow.Mode mode
    );
    event PaymentNote(uint256 indexed id, address indexed recipient, bytes sealedNote);

    function test_CreateNative() public {
        uint64 expectedDeadline = uint64(block.timestamp) + 7 days;
        vm.expectEmit(address(escrow));
        emit PaymentCreated(1, alice, bob, address(0), 5 ether, expectedDeadline, QrowEscrow.Mode.Direct);
        uint256 id = _createNative(5 ether);

        assertEq(id, 1);
        assertEq(address(escrow).balance, 5 ether);
        QrowEscrow.Payment memory p = escrow.getPayment(id);
        assertEq(p.sender, alice);
        assertEq(p.recipient, bob);
        assertEq(p.token, address(0));
        assertEq(p.amount, 5 ether);
        assertEq(p.createdAt, block.timestamp);
        assertEq(p.deadline, expectedDeadline);
        assertEq(uint8(p.status), uint8(QrowEscrow.Status.Pending));
        assertEq(escrow.pqNonce(alice), 1);
    }

    function test_CreateErc20() public {
        uint256 id = _create(alice, bob, address(fusd), 100 ether, DIRECT);
        assertEq(fusd.balanceOf(address(escrow)), 100 ether);
        assertEq(fusd.balanceOf(alice), 900 ether);
        assertEq(escrow.getPayment(id).amount, 100 ether);
    }

    function test_CreateWithSealedNote_EmitsNote() public {
        bytes memory note = hex"51524f57deadbeef";
        uint64 v = _validUntil();
        bytes memory sig =
            _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, note), v);
        vm.expectEmit(address(escrow));
        emit PaymentNote(1, bob, note);
        vm.prank(alice);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, note, v, sig);
    }

    function test_CreateRecordsReceivedForFeeOnTransfer() public {
        FeeOnTransferToken fee = new FeeOnTransferToken();
        fee.mint(alice, 100 ether);
        vm.prank(alice);
        fee.approve(address(escrow), type(uint256).max);
        uint256 id = _create(alice, bob, address(fee), 100 ether, DIRECT);
        assertEq(escrow.getPayment(id).amount, 90 ether);
        assertEq(fee.balanceOf(address(escrow)), 90 ether);
    }

    function test_RevertWhen_TokenReturnsFalse() public {
        FalseToken f = new FalseToken();
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(f), ONE, DIRECT, ""), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.TransferFailed.selector);
        escrow.createPayment(bob, address(f), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_RevertWhen_TokenHasNoCode() public {
        address notAToken = makeAddr("eoa-token");
        uint64 v = _validUntil();
        bytes memory sig =
            _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, notAToken, ONE, DIRECT, ""), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.TransferFailed.selector);
        escrow.createPayment(bob, notAToken, ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_RevertWhen_RecipientInvalid() public {
        address[3] memory bad = [address(0), alice, address(escrow)];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.prank(alice);
            vm.expectRevert(QrowEscrow.InvalidRecipient.selector);
            escrow.createPayment{value: ONE}(bad[i], address(0), ONE, QrowEscrow.Mode.Direct, "", _validUntil(), "");
        }
    }

    function test_RevertWhen_AmountZero() public {
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.InvalidAmount.selector);
        escrow.createPayment(bob, address(0), 0, QrowEscrow.Mode.Direct, "", _validUntil(), "");
    }

    function test_RevertWhen_NativeValueMismatch() public {
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadValue.selector);
        escrow.createPayment{value: ONE - 1}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", _validUntil(), "");
    }

    function test_RevertWhen_Erc20WithValue() public {
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadValue.selector);
        escrow.createPayment{value: 1}(bob, address(fusd), ONE, QrowEscrow.Mode.Direct, "", _validUntil(), "");
    }

    function test_RevertWhen_SenderHasNoPqKey() public {
        address noKey = makeAddr("nokey");
        vm.deal(noKey, 10 ether);
        uint64 v = _validUntil();
        vm.prank(noKey);
        vm.expectRevert(QrowEscrow.NoPqKey.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, new bytes(4627));
    }

    function test_RevertWhen_KeyNotPossessionProven() public {
        keyStatus.setKey(alice, true, QorePQC.ALG_ML_DSA_87, _pubkey(alice), false);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.NoPqKey.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_RevertWhen_KeyWrongAlgorithm() public {
        keyStatus.setKey(alice, true, 2, _pubkey(alice), true);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.NoPqKey.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_RevertWhen_KeyWrongLength() public {
        keyStatus.setKey(alice, true, QorePQC.ALG_ML_DSA_87, hex"01020304", true);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.NoPqKey.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", _validUntil(), "");
    }

    function test_RevertWhen_SignatureExpired() public {
        uint64 v = uint64(block.timestamp + 5 minutes);
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        vm.warp(v + 1);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.SignatureExpired.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_SignatureValidAtExactValidUntil() public {
        uint64 v = uint64(block.timestamp + 5 minutes);
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        vm.warp(v);
        vm.prank(alice);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_RevertWhen_SignatureValidityTooLong() public {
        uint64 v = uint64(block.timestamp + 1 hours + 1);
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.SignatureTooLong.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_RevertWhen_SignatureWrongLength() public {
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        bytes memory shortSig = new bytes(4626);
        for (uint256 i = 0; i < 4626; i++) shortSig[i] = sig[i];
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, shortSig);
    }

    function test_RevertWhen_ParamsDifferFromSigned() public {
        uint64 v = _validUntil();
        // Signed for bob, 1 QOR...
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        // ...submitted for mallory.
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: ONE}(mallory, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
        // ...or for 2 QOR.
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: 2 * ONE}(bob, address(0), 2 * ONE, QrowEscrow.Mode.Direct, "", v, sig);
        // ...or in freelancer mode.
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Freelancer, "", v, sig);
        // ...or with a different sealed note.
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, hex"01", v, sig);
    }

    function test_RevertWhen_SignatureReplayed() public {
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        vm.prank(alice);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_RevertWhen_PrecompilesInactive() public {
        // An inactive precompile answers 0x. The escrow must fail closed.
        vm.etch(QorePQC.PQC_KEY_STATUS, "");
        vm.etch(QorePQC.PQC_VERIFY, "");
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.NoPqKey.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", _validUntil(), new bytes(4627));
        assertFalse(escrow.hasPqKey(alice));
    }

    function test_RevertWhen_VerifyPrecompileInactive() public {
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), ONE, DIRECT, ""), v);
        vm.etch(QorePQC.PQC_VERIFY, "");
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.createPayment{value: ONE}(bob, address(0), ONE, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_IdsIncrement() public {
        assertEq(_createNative(ONE), 1);
        assertEq(_createNative(ONE), 2);
        assertEq(_createNative(ONE), 3);
        assertEq(escrow.paymentCount(), 3);
    }

    function test_HasPqKey() public {
        assertTrue(escrow.hasPqKey(bob));
        assertFalse(escrow.hasPqKey(makeAddr("nobody")));
    }

    function testFuzz_CreateNative(uint96 amount) public {
        vm.assume(amount > 0 && amount <= 1_000 ether);
        uint256 id = _createNative(amount);
        assertEq(escrow.getPayment(id).amount, amount);
        assertEq(address(escrow).balance, amount);
    }
}

contract ClaimTest is Base {
    function test_ClaimNative() public {
        uint256 id = _createNative(5 ether);
        uint256 before = bob.balance;
        _claim(bob, id);
        assertEq(bob.balance, before + 5 ether);
        assertEq(address(escrow).balance, 0);
        assertEq(uint8(_status(id)), uint8(QrowEscrow.Status.Claimed));
    }

    function test_ClaimErc20() public {
        uint256 id = _create(alice, bob, address(fusd), 40 ether, DIRECT);
        _claim(bob, id);
        assertEq(fusd.balanceOf(bob), 40 ether);
    }

    function test_ClaimJustBeforeDeadline() public {
        uint256 id = _createNative(ONE);
        vm.warp(escrow.getPayment(id).deadline - 1);
        _claim(bob, id);
        assertEq(uint8(_status(id)), uint8(QrowEscrow.Status.Claimed));
    }

    function test_RevertWhen_ClaimAtDeadline() public {
        uint256 id = _createNative(ONE);
        vm.warp(escrow.getPayment(id).deadline);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(bob, escrow.ACTION_CLAIM(), _idParams(id), v);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.Expired.selector);
        escrow.claim(id, v, sig);
    }

    function test_RevertWhen_ClaimByNonRecipient() public {
        uint256 id = _createNative(ONE);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(carol, escrow.ACTION_CLAIM(), _idParams(id), v);
        vm.prank(carol);
        vm.expectRevert(QrowEscrow.NotRecipient.selector);
        escrow.claim(id, v, sig);
    }

    function test_RevertWhen_ClaimTwice() public {
        uint256 id = _createNative(ONE);
        _claim(bob, id);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(bob, escrow.ACTION_CLAIM(), _idParams(id), v);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.NotPending.selector);
        escrow.claim(id, v, sig);
    }

    function test_RevertWhen_ClaimUnknown() public {
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.UnknownPayment.selector);
        escrow.claim(99, _validUntil(), "");
    }

    function test_RevertWhen_ClaimFreelancerPayment() public {
        uint256 id = _create(alice, bob, address(0), ONE, FREELANCER);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(bob, escrow.ACTION_CLAIM(), _idParams(id), v);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.WrongMode.selector);
        escrow.claim(id, v, sig);
    }

    function test_RevertWhen_RecipientHasNoPqKey() public {
        address fresh = makeAddr("fresh");
        uint256 id = _create(alice, fresh, address(0), ONE, DIRECT);
        vm.prank(fresh);
        vm.expectRevert(QrowEscrow.NoPqKey.selector);
        escrow.claim(id, _validUntil(), new bytes(4627));
    }

    function test_RecipientRegistersKeyLaterThenClaims() public {
        address fresh = makeAddr("fresh");
        uint256 id = _create(alice, fresh, address(0), ONE, DIRECT);
        _registerKey(fresh);
        _claim(fresh, id);
        assertEq(fresh.balance, ONE);
    }

    function test_RevertWhen_ClaimSigForOtherId() public {
        uint256 id1 = _createNative(ONE);
        uint256 id2 = _createNative(ONE);
        uint64 v = _validUntil();
        bytes memory sigFor1 = _sigFor(bob, escrow.ACTION_CLAIM(), _idParams(id1), v);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.claim(id2, v, sigFor1);
    }

    function test_RevertWhen_ClaimWithCancelSig() public {
        // Action tag separates otherwise identical (id) params.
        uint256 id = _createNative(ONE);
        uint64 v = _validUntil();
        bytes memory cancelSig = _sigFor(bob, escrow.ACTION_CANCEL(), _idParams(id), v);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.claim(id, v, cancelSig);
    }

    function test_RevertWhen_SigFromOtherEscrowDeployment() public {
        QrowEscrow other = new QrowEscrow();
        uint256 id = _createNative(ONE);
        uint64 v = _validUntil();
        bytes32 digest = other.actionDigest(escrow.ACTION_CLAIM(), bob, 0, v, _idParams(id));
        bytes memory sig = _signDigest(bob, digest);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.claim(id, v, sig);
    }

    function test_RevertWhen_SigFromOtherChain() public {
        uint256 id = _createNative(ONE);
        uint64 v = _validUntil();
        vm.chainId(1);
        bytes32 digest = escrow.actionDigest(escrow.ACTION_CLAIM(), bob, 0, v, _idParams(id));
        bytes memory sig = _signDigest(bob, digest);
        vm.chainId(9800);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.claim(id, v, sig);
    }
}

contract CancelTest is Base {
    function test_CancelNative() public {
        uint256 id = _createNative(5 ether);
        uint256 before = alice.balance;
        _cancel(alice, id);
        assertEq(alice.balance, before + 5 ether);
        assertEq(uint8(_status(id)), uint8(QrowEscrow.Status.Cancelled));
    }

    function test_CancelErc20() public {
        uint256 id = _create(alice, bob, address(fusd), 10 ether, DIRECT);
        _cancel(alice, id);
        assertEq(fusd.balanceOf(alice), 1_000 ether);
    }

    function test_CancelFreelancer() public {
        uint256 id = _create(alice, bob, address(0), ONE, FREELANCER);
        _cancel(alice, id);
        assertEq(uint8(_status(id)), uint8(QrowEscrow.Status.Cancelled));
    }

    function test_RevertWhen_CancelByRecipient() public {
        uint256 id = _createNative(ONE);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(bob, escrow.ACTION_CANCEL(), _idParams(id), v);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.NotSender.selector);
        escrow.cancel(id, v, sig);
    }

    function test_RevertWhen_CancelAfterClaim() public {
        uint256 id = _createNative(ONE);
        _claim(bob, id);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CANCEL(), _idParams(id), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.NotPending.selector);
        escrow.cancel(id, v, sig);
    }

    function test_RevertWhen_ClaimAfterCancel() public {
        uint256 id = _createNative(ONE);
        _cancel(alice, id);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(bob, escrow.ACTION_CLAIM(), _idParams(id), v);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.NotPending.selector);
        escrow.claim(id, v, sig);
    }

    function test_RevertWhen_CancelWithoutPqSig() public {
        uint256 id = _createNative(ONE);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.cancel(id, _validUntil(), new bytes(4627));
    }
}

contract ReleaseTest is Base {
    function test_ReleaseFreelancer() public {
        uint256 id = _create(alice, bob, address(fusd), 50 ether, FREELANCER);
        _release(alice, id);
        assertEq(fusd.balanceOf(bob), 50 ether);
        assertEq(uint8(_status(id)), uint8(QrowEscrow.Status.Released));
    }

    function test_ReleaseRecipientWithoutPqKey() public {
        // Release is authorised by the sender's PQ key; the recipient needs none.
        address fresh = makeAddr("fresh");
        uint256 id = _create(alice, fresh, address(0), ONE, FREELANCER);
        _release(alice, id);
        assertEq(fresh.balance, ONE);
    }

    function test_RevertWhen_ReleaseDirectPayment() public {
        uint256 id = _createNative(ONE);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_RELEASE(), _idParams(id), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.WrongMode.selector);
        escrow.release(id, v, sig);
    }

    function test_RevertWhen_ReleaseByRecipient() public {
        uint256 id = _create(alice, bob, address(0), ONE, FREELANCER);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(bob, escrow.ACTION_RELEASE(), _idParams(id), v);
        vm.prank(bob);
        vm.expectRevert(QrowEscrow.NotSender.selector);
        escrow.release(id, v, sig);
    }

    function test_RevertWhen_ReleaseAtDeadline() public {
        uint256 id = _create(alice, bob, address(0), ONE, FREELANCER);
        vm.warp(escrow.getPayment(id).deadline);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_RELEASE(), _idParams(id), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.Expired.selector);
        escrow.release(id, v, sig);
    }

    function test_FreelancerRefundsIfNotReleased() public {
        uint256 id = _create(alice, bob, address(0), ONE, FREELANCER);
        uint256 before = alice.balance;
        vm.warp(escrow.getPayment(id).deadline);
        vm.prank(carol);
        escrow.refundExpired(id);
        assertEq(alice.balance, before + ONE);
    }
}

contract RefundTest is Base {
    event PaymentRefunded(uint256 indexed id, address indexed sender, uint256 amount, address indexed caller);

    function test_RefundAtDeadlineByAnyone() public {
        uint256 id = _createNative(3 ether);
        uint256 before = alice.balance;
        vm.warp(escrow.getPayment(id).deadline);
        vm.expectEmit(address(escrow));
        emit PaymentRefunded(id, alice, 3 ether, carol);
        vm.prank(carol);
        escrow.refundExpired(id);
        assertEq(alice.balance, before + 3 ether);
        assertEq(uint8(_status(id)), uint8(QrowEscrow.Status.Refunded));
    }

    function test_RefundByAttackerStillPaysSender() public {
        uint256 id = _create(alice, bob, address(fusd), 25 ether, DIRECT);
        vm.warp(block.timestamp + 30 days);
        vm.prank(mallory);
        escrow.refundExpired(id);
        assertEq(fusd.balanceOf(alice), 1_000 ether);
        assertEq(fusd.balanceOf(mallory), 0);
    }

    function test_RevertWhen_RefundBeforeDeadline() public {
        uint256 id = _createNative(ONE);
        vm.warp(escrow.getPayment(id).deadline - 1);
        vm.expectRevert(QrowEscrow.NotExpired.selector);
        escrow.refundExpired(id);
    }

    function test_RevertWhen_RefundTwice() public {
        uint256 id = _createNative(ONE);
        vm.warp(escrow.getPayment(id).deadline);
        escrow.refundExpired(id);
        vm.expectRevert(QrowEscrow.NotPending.selector);
        escrow.refundExpired(id);
    }

    function test_RevertWhen_RefundAfterClaim() public {
        uint256 id = _createNative(ONE);
        _claim(bob, id);
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(QrowEscrow.NotPending.selector);
        escrow.refundExpired(id);
    }

    function test_RevertWhen_RefundUnknown() public {
        vm.expectRevert(QrowEscrow.UnknownPayment.selector);
        escrow.refundExpired(42);
    }

    function testFuzz_RefundTiming(uint32 elapsed) public {
        uint256 id = _createNative(ONE);
        vm.warp(block.timestamp + elapsed);
        if (elapsed < 7 days) {
            vm.expectRevert(QrowEscrow.NotExpired.selector);
            escrow.refundExpired(id);
        } else {
            escrow.refundExpired(id);
            assertEq(uint8(_status(id)), uint8(QrowEscrow.Status.Refunded));
        }
    }
}

contract LimitsTest is Base {
    function test_DefaultNoLimits() public {
        _createNative(500 ether);
        assertEq(escrow.spentToday(alice, address(0)), 500 ether);
    }

    function test_MaxPerPayment() public {
        _setLimits(alice, address(0), 10 ether, 0);
        _createNative(10 ether);
        uint64 v = _validUntil();
        bytes memory sig =
            _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), 11 ether, DIRECT, ""), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.OverPaymentLimit.selector);
        escrow.createPayment{value: 11 ether}(bob, address(0), 11 ether, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_MaxPerDayAndReset() public {
        _setLimits(alice, address(0), 0, 10 ether);
        _createNative(6 ether);
        _createNative(4 ether);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), 1, DIRECT, ""), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.OverDailyLimit.selector);
        escrow.createPayment{value: 1}(bob, address(0), 1, QrowEscrow.Mode.Direct, "", v, sig);

        // Next UTC day resets the allowance.
        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        assertEq(escrow.spentToday(alice, address(0)), 0);
        _createNative(10 ether);
    }

    function test_CancelDoesNotRestoreDailyAllowance() public {
        _setLimits(alice, address(0), 0, 5 ether);
        uint256 id = _createNative(5 ether);
        _cancel(alice, id);
        assertEq(escrow.spentToday(alice, address(0)), 5 ether);
    }

    function test_LimitsArePerToken() public {
        _setLimits(alice, address(fusd), 1 ether, 0);
        _createNative(50 ether); // native unaffected
        uint64 v = _validUntil();
        bytes memory sig =
            _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(fusd), 2 ether, DIRECT, ""), v);
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.OverPaymentLimit.selector);
        escrow.createPayment(bob, address(fusd), 2 ether, QrowEscrow.Mode.Direct, "", v, sig);
    }

    function test_LimitsArePerSender() public {
        _setLimits(alice, address(0), 1 ether, 0);
        _create(bob, alice, address(0), 5 ether, DIRECT);
    }

    function test_LimitsView() public {
        _setLimits(alice, address(0), 3 ether, 7 ether);
        QrowEscrow.Limits memory l = escrow.limitsOf(alice, address(0));
        assertEq(l.maxPerPayment, 3 ether);
        assertEq(l.maxPerDay, 7 ether);
    }

    function test_RevertWhen_SetLimitsWithoutPqSig() public {
        vm.prank(alice);
        vm.expectRevert(QrowEscrow.BadPqSignature.selector);
        escrow.setLimits(address(0), 0, 0, _validUntil(), new bytes(4627));
    }

    function testFuzz_DailyLimit(uint64 limit, uint64 a, uint64 b) public {
        vm.assume(limit > 0 && a > 0 && b > 0);
        _setLimits(alice, address(0), 0, limit);
        if (a > limit) return;
        _createNative(a);
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(alice, escrow.ACTION_CREATE(), _createParams(bob, address(0), b, DIRECT, ""), v);
        vm.prank(alice);
        if (uint256(a) + b > limit) vm.expectRevert(QrowEscrow.OverDailyLimit.selector);
        escrow.createPayment{value: b}(bob, address(0), b, QrowEscrow.Mode.Direct, "", v, sig);
    }
}

contract InvariantsTest is Base {
    /// @dev The escrow holds exactly the sum of pending amounts after any mix of actions.
    function testFuzz_BalanceMatchesPending(uint8 seed) public {
        uint256[5] memory ids;
        for (uint256 i = 0; i < 5; i++) ids[i] = _createNative((i + 1) * ONE);
        if (seed & 1 != 0) _claim(bob, ids[0]);
        if (seed & 2 != 0) _cancel(alice, ids[1]);
        if (seed & 4 != 0) _claim(bob, ids[2]);
        vm.warp(block.timestamp + 7 days);
        if (seed & 8 != 0) escrow.refundExpired(ids[3]);

        uint256 pending;
        for (uint256 i = 0; i < 5; i++) {
            QrowEscrow.Payment memory p = escrow.getPayment(ids[i]);
            if (p.status == QrowEscrow.Status.Pending) pending += p.amount;
        }
        assertEq(address(escrow).balance, pending);
    }
}
