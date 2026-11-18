// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PqBase} from "./PqBase.t.sol";
import {PqAuth} from "../src/PqAuth.sol";
import {QrowPerps} from "../src/QrowPerps.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PerpsTest is PqBase {
    QrowPerps internal x;
    uint256 internal signerPk = 0xA11CE;
    bytes32 internal constant ETH = keccak256("ETH/USDT");
    uint256 internal constant U = 1e6;
    uint256 internal constant P = 3000e8; // $3,000

    function setUp() public override {
        super.setUp();
        x = new QrowPerps(address(fusd), vm.addr(signerPk), "qorechain-diana", address(0));
        x.setPair(ETH, true);
        fusd.mint(address(this), 100_000 * U);
        fusd.approve(address(x), type(uint256).max);
        x.fundPool(10_000 * U);
        fusd.mint(alice, 10_000 * U);
        vm.prank(alice);
        fusd.approve(address(x), type(uint256).max);
    }

    function _report(bytes32 pair, uint256 price) internal view returns (QrowPerps.PriceReport memory r) {
        uint64 t = uint64(block.timestamp);
        bytes32 d = MessageHashUtils.toEthSignedMessageHash(x.reportHash(pair, price, t));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(signerPk, d);
        r = QrowPerps.PriceReport(pair, price, t, abi.encodePacked(rr, s, v));
    }

    function _open(bool isLong, uint256 margin, uint256 lev) internal returns (uint256) {
        uint256 limit = isLong ? P * 101 / 100 : P * 99 / 100;
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(x, alice, x.ACTION_OPEN(), keccak256(abi.encode(ETH, isLong, margin, lev, limit)), v);
        QrowPerps.PriceReport memory r = _report(ETH, P);
        vm.prank(alice);
        return x.open(ETH, isLong, margin, lev, limit, r, v, sig);
    }

    function _close(uint256 id, uint256 price) internal returns (uint256) {
        uint64 v = _validUntil();
        QrowPerps.Position memory p = x.getPosition(id);
        uint256 limit = p.isLong ? 0 : type(uint256).max;
        bytes memory sig = _pqSig(x, alice, x.ACTION_CLOSE(), keccak256(abi.encode(id, limit)), v);
        QrowPerps.PriceReport memory r = _report(ETH, price);
        vm.prank(alice);
        return x.close(id, limit, r, v, sig);
    }

    function test_longProfitAt10x() public {
        uint256 id = _open(true, 100 * U, 10); // size 1,000
        uint256 before = fusd.balanceOf(alice);
        uint256 paid = _close(id, 3300e8); // +10% → +100 fUSD
        // margin 100 - 0.5 open fee + 100 profit - 0.5 close fee = 199
        assertEq(paid, 199 * U);
        assertEq(fusd.balanceOf(alice) - before, 199 * U);
        assertEq(x.getPosition(id).pnl, int256(99 * U));
    }

    function test_shortLossAt5x() public {
        uint256 id = _open(false, 100 * U, 5); // size 500
        uint256 paid = _close(id, 3150e8); // +5% against a short → -25
        assertEq(paid, 100 * U - 250_000 - 25 * U - 250_000);
    }

    function test_liquidationPriceAndLiquidation() public {
        uint256 id = _open(true, 100 * U, 100); // size 10,000; fee 5 → margin 95
        uint256 liq = x.liquidationPrice(id);
        assertLt(liq, P);
        assertGt(liq, P * 99 / 100); // under 1% away at 100x
        QrowPerps.PriceReport memory above = _report(ETH, liq + 2e8);
        vm.expectRevert(QrowPerps.NotLiquidatable.selector);
        x.liquidate(id, above);
        QrowPerps.PriceReport memory at = _report(ETH, liq);
        vm.prank(carol);
        x.liquidate(id, at);
        assertFalse(x.getPosition(id).open);
        assertEq(x.getPosition(id).closedBy, 2);
        assertEq(x.lockedMargin(), 0);
    }

    function test_rejectsForgedOrStaleReportsAndBadLeverage() public {
        uint64 v = _validUntil();
        QrowPerps.PriceReport memory r = _report(ETH, P);
        r.price = 1e8; // tampered
        bytes memory sig = _pqSig(x, alice, x.ACTION_OPEN(), keccak256(abi.encode(ETH, true, 100 * U, uint256(10), P * 2)), v);
        vm.prank(alice);
        vm.expectRevert(QrowPerps.BadReport.selector);
        x.open(ETH, true, 100 * U, 10, P * 2, r, v, sig);

        QrowPerps.PriceReport memory old = _report(ETH, P);
        vm.warp(block.timestamp + 3 minutes);
        v = _validUntil();
        sig = _pqSig(x, alice, x.ACTION_OPEN(), keccak256(abi.encode(ETH, true, 100 * U, uint256(10), P * 2)), v);
        vm.prank(alice);
        vm.expectRevert(QrowPerps.StaleReport.selector);
        x.open(ETH, true, 100 * U, 10, P * 2, old, v, sig);

        QrowPerps.PriceReport memory fresh = _report(ETH, P);
        vm.prank(alice);
        vm.expectRevert(QrowPerps.BadLeverage.selector);
        x.open(ETH, true, 100 * U, 101, P * 2, fresh, v, sig);
    }

    function test_priceLimitProtectsTrader() public {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(x, alice, x.ACTION_OPEN(), keccak256(abi.encode(ETH, true, 100 * U, uint256(10), P - 1)), v);
        QrowPerps.PriceReport memory r = _report(ETH, P);
        vm.prank(alice);
        vm.expectRevert(QrowPerps.PriceLimit.selector);
        x.open(ETH, true, 100 * U, 10, P - 1, r, v, sig);
    }

    function test_onlyTraderCloses_andNeedsPq() public {
        uint256 id = _open(true, 10 * U, 2);
        uint64 v = _validUntil();
        QrowPerps.PriceReport memory r = _report(ETH, P);
        vm.prank(mallory);
        vm.expectRevert(QrowPerps.NotTrader.selector);
        x.close(id, 0, r, v, _forgedSig());
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        x.close(id, 0, r, v, _forgedSig());
    }

    function test_profitCappedByPool() public {
        uint256 id = _open(true, 5_000 * U, 100); // size 500,000
        uint256 paid = _close(id, 6000e8); // +100% → far more than the pool
        assertLe(paid, 15_000 * U); // pool 10,000 + margin 5,000 at most
        assertEq(x.lockedMargin(), 0);
    }

    function testFuzz_contractStaysSolvent(uint64 move, bool isLong, uint8 lev) public {
        uint256 l = bound(uint256(lev), 1, 100);
        uint256 exitP = bound(uint256(move), P / 2, P * 2);
        uint256 id = _open(isLong, 200 * U, l);
        if (x.getPosition(id).open) {
            // Liquidate if possible, otherwise close.
            QrowPerps.PriceReport memory r = _report(ETH, exitP);
            try x.liquidate(id, r) {} catch {
                _close(id, exitP);
            }
        }
        assertGe(fusd.balanceOf(address(x)), x.lockedMargin());
    }
}
