// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QrowEscrow} from "../src/QrowEscrow.sol";
import {QorePQC} from "../src/IQorePQC.sol";
import {MockPQCKeyStatus, MockPQCVerify} from "./mocks/MockPQC.sol";
import {MockERC20} from "./mocks/Tokens.sol";

abstract contract Base is Test {
    QrowEscrow internal escrow;
    MockERC20 internal fusd;

    MockPQCKeyStatus internal keyStatus = MockPQCKeyStatus(QorePQC.PQC_KEY_STATUS);
    MockPQCVerify internal verifier = MockPQCVerify(QorePQC.PQC_VERIFY);

    address internal alice = makeAddr("alice"); // sender
    address internal bob = makeAddr("bob"); // recipient
    address internal carol = makeAddr("carol"); // third party / keeper
    address internal mallory = makeAddr("mallory"); // attacker's own address

    uint256 internal constant ONE = 1 ether;
    uint8 internal constant DIRECT = 0;
    uint8 internal constant FREELANCER = 1;

    function setUp() public virtual {
        vm.warp(1_800_000_000); // a realistic timestamp
        vm.etch(QorePQC.PQC_KEY_STATUS, type(MockPQCKeyStatus).runtimeCode);
        vm.etch(QorePQC.PQC_VERIFY, type(MockPQCVerify).runtimeCode);

        escrow = new QrowEscrow("qorechain-diana");
        fusd = new MockERC20("Faucet USD", "fUSD");

        _registerKey(alice);
        _registerKey(bob);
        _registerKey(carol);

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 10 ether);
        fusd.mint(alice, 1_000 ether);
        vm.prank(alice);
        fusd.approve(address(escrow), type(uint256).max);
    }

    // ---------------------------------------------------------------- PQ helpers

    function _pubkey(address who) internal pure returns (bytes memory pk) {
        pk = new bytes(QorePQC.ML_DSA_87_PUBKEY_LEN);
        bytes32 seed = keccak256(abi.encode("pk", who));
        for (uint256 i = 0; i < 32; i++) pk[i] = seed[i];
    }

    function _registerKey(address who) internal {
        keyStatus.setKey(who, true, QorePQC.ALG_ML_DSA_87, _pubkey(who), true);
    }

    /// @dev Models the key holder signing with their ML-DSA-87 key.
    function _signDigest(address who, bytes32 digest) internal returns (bytes memory sig) {
        sig = new bytes(QorePQC.ML_DSA_87_SIG_LEN);
        bytes32 tag = keccak256(abi.encode("sig", who, digest));
        for (uint256 i = 0; i < 32; i++) sig[i] = tag[i];
        verifier.record(_pubkey(who), sig, escrow.pqMessage(digest));
    }

    function _validUntil() internal view returns (uint64) {
        return uint64(block.timestamp + 10 minutes);
    }

    function _sigFor(address who, bytes32 action, bytes32 params, uint64 validUntil) internal returns (bytes memory) {
        bytes32 digest = escrow.actionDigest(action, who, escrow.pqNonce(who), validUntil, params);
        return _signDigest(who, digest);
    }

    function _createParams(address recipient, address token, uint256 amount, uint8 mode, bytes memory note)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(recipient, token, amount, mode, keccak256(note)));
    }

    function _idParams(uint256 id) internal pure returns (bytes32) {
        return keccak256(abi.encode(id));
    }

    // ---------------------------------------------------------------- action helpers

    function _create(address from, address to, address token, uint256 amount, uint8 mode)
        internal
        returns (uint256 id)
    {
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(from, escrow.ACTION_CREATE(), _createParams(to, token, amount, mode, ""), v);
        vm.prank(from);
        id = escrow.createPayment{value: token == address(0) ? amount : 0}(
            to, token, amount, QrowEscrow.Mode(mode), "", v, sig
        );
    }

    function _createNative(uint256 amount) internal returns (uint256) {
        return _create(alice, bob, address(0), amount, DIRECT);
    }

    function _claim(address who, uint256 id) internal {
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(who, escrow.ACTION_CLAIM(), _idParams(id), v);
        vm.prank(who);
        escrow.claim(id, v, sig);
    }

    function _cancel(address who, uint256 id) internal {
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(who, escrow.ACTION_CANCEL(), _idParams(id), v);
        vm.prank(who);
        escrow.cancel(id, v, sig);
    }

    function _release(address who, uint256 id) internal {
        uint64 v = _validUntil();
        bytes memory sig = _sigFor(who, escrow.ACTION_RELEASE(), _idParams(id), v);
        vm.prank(who);
        escrow.release(id, v, sig);
    }

    function _setLimits(address who, address token, uint256 perPayment, uint256 perDay) internal {
        uint64 v = _validUntil();
        bytes memory sig =
            _sigFor(who, escrow.ACTION_SET_LIMITS(), keccak256(abi.encode(token, perPayment, perDay)), v);
        vm.prank(who);
        escrow.setLimits(token, perPayment, perDay, v, sig);
    }

    function _status(uint256 id) internal view returns (QrowEscrow.Status) {
        return escrow.getPayment(id).status;
    }
}
