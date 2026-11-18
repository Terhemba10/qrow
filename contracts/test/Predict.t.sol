// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PqBase} from "./PqBase.t.sol";
import {PqAuth} from "../src/PqAuth.sol";
import {QrowPredict} from "../src/QrowPredict.sol";

contract PredictTest is PqBase {
    QrowPredict internal p;
    uint256 internal constant U = 1e6; // 1 fUSD
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        p = new QrowPredict(address(fusd), "qorechain-diana", address(0));
        fusd.mint(address(this), 10_000 * U);
        fusd.approve(address(p), type(uint256).max);
        id = p.createMarket("Will BTC close above $100k this month?", "Crypto", uint64(block.timestamp + 7 days), 100 * U);
        fusd.mint(bob, 1_000 * U);
        fusd.mint(carol, 1_000 * U);
        vm.prank(alice);
        fusd.approve(address(p), type(uint256).max);
        vm.prank(bob);
        fusd.approve(address(p), type(uint256).max);
        vm.prank(carol);
        fusd.approve(address(p), type(uint256).max);
    }

    function _buy(address who, bool yes, uint256 amount) internal returns (uint256) {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(p, who, p.ACTION_BUY(), keccak256(abi.encode(id, yes, amount, uint256(0))), v);
        vm.prank(who);
        return p.buy(id, yes, amount, 0, v, sig);
    }

    function _sell(address who, bool yes, uint256 shares) internal returns (uint256) {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(p, who, p.ACTION_SELL(), keccak256(abi.encode(id, yes, shares, uint256(0))), v);
        vm.prank(who);
        return p.sell(id, yes, shares, 0, v, sig);
    }

    function _claim(address who) internal returns (uint256) {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(p, who, p.ACTION_CLAIM(), keccak256(abi.encode(id)), v);
        vm.prank(who);
        return p.claim(id, v, sig);
    }

    function _end() internal {
        vm.warp(block.timestamp + 7 days + 1);
    }

    function test_startsAtFiftyFifty() public view {
        assertEq(p.yesPriceE6(id), 500_000);
    }

    function test_buyYesRaisesYesPrice() public {
        uint256 quoted = p.quoteBuy(id, true, 10 * U);
        uint256 got = _buy(alice, true, 10 * U);
        assertEq(got, quoted);
        assertGt(got, 10 * U * 99 / 100); // more than 9.9 shares at ~0.5
        assertGt(p.yesPriceE6(id), 500_000);
        (uint256 y, uint256 n) = p.sharesOf(id, alice);
        assertEq(y, got);
        assertEq(n, 0);
    }

    function test_buyNeedsPqSignature() public {
        uint64 v = _validUntil();
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        p.buy(id, true, 10 * U, 0, v, _forgedSig());
    }

    function test_slippageGuard() public {
        uint64 v = _validUntil();
        uint256 tooMany = p.quoteBuy(id, true, 10 * U) + 1;
        bytes memory sig = _pqSig(p, alice, p.ACTION_BUY(), keccak256(abi.encode(id, true, 10 * U, tooMany)), v);
        vm.prank(alice);
        vm.expectRevert(QrowPredict.Slippage.selector);
        p.buy(id, true, 10 * U, tooMany, v, sig);
    }

    function test_sellRoundTripLosesOnlyFees() public {
        uint256 before = fusd.balanceOf(alice);
        uint256 shares = _buy(alice, true, 20 * U);
        uint256 out = _sell(alice, true, shares);
        uint256 spent = before - fusd.balanceOf(alice);
        assertLe(spent, 20 * U * 21 / 1000); // about 2% (two 1% fees) plus rounding
        assertGt(out, 19 * U);
        assertEq(p.yesPriceE6(id) / 1000, 500); // back to ~0.5
    }

    function test_resolveYesPaysWinnersAfterDelay() public {
        uint256 yes = _buy(alice, true, 30 * U);
        _buy(bob, false, 30 * U);
        _end();
        p.resolve(id, QrowPredict.Outcome.Yes);
        vm.prank(alice);
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(p, alice, p.ACTION_CLAIM(), keccak256(abi.encode(id)), v);
        vm.prank(alice);
        vm.expectRevert(QrowPredict.DisputeWindow.selector);
        p.claim(id, v, sig);

        vm.warp(block.timestamp + 1 hours);
        uint256 before = fusd.balanceOf(alice);
        assertEq(_claim(alice), yes);
        assertEq(fusd.balanceOf(alice) - before, yes);
        assertEq(p.payoutOf(id, bob), 0);
        // LP takes the rest; the contract never pays out more than it holds.
        uint256 lp = p.withdrawLiquidity(id);
        assertGt(lp, 0);
        assertEq(fusd.balanceOf(address(p)), p.getMarket(id).collateral);
    }

    function test_resolverCanCorrectDuringDelayOnly() public {
        _end();
        p.resolve(id, QrowPredict.Outcome.Yes);
        p.resolve(id, QrowPredict.Outcome.No);
        assertEq(uint8(p.getMarket(id).outcome), uint8(QrowPredict.Outcome.No));
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(QrowPredict.AlreadyFinal.selector);
        p.resolve(id, QrowPredict.Outcome.Yes);
    }

    function test_invalidRefundsHalfPerShare_solvent() public {
        uint256 a = _buy(alice, true, 40 * U);
        uint256 b = _buy(bob, false, 25 * U);
        uint256 c = _buy(carol, true, 5 * U);
        _end();
        p.resolve(id, QrowPredict.Outcome.Invalid);
        vm.warp(block.timestamp + 1 hours);
        assertEq(_claim(alice), a / 2);
        assertEq(_claim(bob), b / 2);
        assertEq(_claim(carol), c / 2);
        p.withdrawLiquidity(id);
        // Everything owed was paid from what the market held.
        assertEq(fusd.balanceOf(address(p)), p.getMarket(id).collateral);
    }

    function test_cannotTradeAfterEndOrClaimTwice() public {
        _buy(alice, true, 10 * U);
        _end();
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(p, bob, p.ACTION_BUY(), keccak256(abi.encode(id, true, 10 * U, uint256(0))), v);
        vm.prank(bob);
        vm.expectRevert(QrowPredict.MarketClosed.selector);
        p.buy(id, true, 10 * U, 0, v, sig);
        p.resolve(id, QrowPredict.Outcome.Yes);
        vm.warp(block.timestamp + 1 hours);
        _claim(alice);
        uint64 v2 = _validUntil();
        bytes memory sig2 = _pqSig(p, alice, p.ACTION_CLAIM(), keccak256(abi.encode(id)), v2);
        vm.prank(alice);
        vm.expectRevert(QrowPredict.NothingToClaim.selector);
        p.claim(id, v2, sig2);
    }

    function test_onlyResolversCreateAndResolve() public {
        vm.prank(mallory);
        vm.expectRevert(QrowPredict.NotResolver.selector);
        p.createMarket("x", "y", uint64(block.timestamp + 1 days), 10 * U);
        _end();
        vm.prank(mallory);
        vm.expectRevert(QrowPredict.NotResolver.selector);
        p.resolve(id, QrowPredict.Outcome.Yes);
    }

    function testFuzz_poolNeverLoses(uint96 a1, uint96 a2, bool s1, bool s2) public {
        uint256 x = bound(uint256(a1), U / 10, 300 * U);
        uint256 y = bound(uint256(a2), U / 10, 300 * U);
        fusd.mint(alice, 1_000 * U);
        fusd.mint(bob, 1_000 * U);
        uint256 sa = _buy(alice, s1, x);
        uint256 sb = _buy(bob, s2, y);
        _sell(alice, s1, sa);
        _sell(bob, s2, sb / 2);
        QrowPredict.Market memory m = p.getMarket(id);
        assertGe(m.yesPool * m.noPool, 100 * U * 100 * U);
        // Collateral always covers every complete set outstanding.
        (uint256 by, uint256 bn) = p.sharesOf(id, bob);
        assertGe(m.collateral, m.yesPool + by);
        assertGe(m.collateral, m.noPool + bn);
    }
}
