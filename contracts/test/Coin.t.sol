// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PqBase} from "./PqBase.t.sol";
import {PqAuth} from "../src/PqAuth.sol";
import {QrowCoin} from "../src/QrowCoin.sol";
import {QrowCoinFactory} from "../src/QrowCoinFactory.sol";

contract CoinTest is PqBase {
    QrowCoinFactory internal factory;

    function setUp() public override {
        super.setUp();
        factory = new QrowCoinFactory("qorechain-diana");
    }

    function _launch(address who, string memory name, string memory symbol, uint256 supply, uint16 bps)
        internal
        returns (QrowCoin coin)
    {
        uint64 v = _validUntil();
        bytes32 params = keccak256(abi.encode(keccak256(bytes(name)), keccak256(bytes(symbol)), supply, bps, keccak256(bytes("gm"))));
        bytes memory sig = _pqSig(factory, who, factory.ACTION_LAUNCH(), params, v);
        vm.prank(who);
        coin = QrowCoin(factory.launch(name, symbol, supply, bps, "gm", v, sig));
    }

    function _claim(QrowCoin coin, address who) internal returns (uint256) {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(coin, who, coin.ACTION_CLAIM(), keccak256(abi.encode(address(coin))), v);
        vm.prank(who);
        return coin.claim(v, sig);
    }

    function test_LaunchFixedSupplyAndCreatorShare() public {
        QrowCoin c = _launch(alice, "Paper Lantern", "LANT", 1_000_000, 1_000);
        assertEq(c.totalSupply(), 1_000_000 ether);
        assertEq(c.balanceOf(alice), 100_000 ether);
        assertEq(c.balanceOf(address(c)), 900_000 ether);
        assertEq(c.creator(), alice);
        assertEq(c.creatorBps(), 1_000);
        assertEq(c.decimals(), 18);
        assertEq(c.description(), "gm");
        assertTrue(factory.isQrowCoin(address(c)));
        assertEq(factory.coinCount(), 1);
        assertEq(factory.coins(0, 10)[0], address(c));
    }

    function test_ZeroCreatorShare() public {
        QrowCoin c = _launch(alice, "Fair Seed", "SEED", 1_000, 0);
        assertEq(c.balanceOf(alice), 0);
        assertEq(c.balanceOf(address(c)), 1_000 ether);
    }

    function test_RevertWhen_CreatorShareAbove10Percent() public {
        vm.prank(alice);
        vm.expectRevert(QrowCoinFactory.CreatorShareTooHigh.selector);
        factory.launch("Greedy Goat", "GOAT", 1_000_000, 1_001, "", _validUntil(), "");
    }

    function test_RevertWhen_SupplyOutOfRange() public {
        vm.startPrank(alice);
        vm.expectRevert(QrowCoinFactory.BadSupply.selector);
        factory.launch("Tiny Coin", "TINY", 999, 0, "", _validUntil(), "");
        vm.expectRevert(QrowCoinFactory.BadSupply.selector);
        factory.launch("Huge Coin", "HUGE", 1_000_000_000_001, 0, "", _validUntil(), "");
        vm.stopPrank();
    }

    function test_RevertWhen_BadNameOrSymbol() public {
        string[6] memory badNames = ["ab", " Leading", "Trailing ", "Two  Spaces", "Emoji!", "ThisNameIsWayTooLongForTheLimit33"];
        for (uint256 i = 0; i < badNames.length; i++) {
            vm.prank(alice);
            vm.expectRevert(QrowCoinFactory.BadName.selector);
            factory.launch(badNames[i], "OKAY", 1_000, 0, "", _validUntil(), "");
        }
        string[4] memory badSymbols = ["A", "lower", "TOOLONG99", "AB-C"];
        for (uint256 i = 0; i < badSymbols.length; i++) {
            vm.prank(alice);
            vm.expectRevert(QrowCoinFactory.BadSymbol.selector);
            factory.launch("Fine Name", badSymbols[i], 1_000, 0, "", _validUntil(), "");
        }
    }

    function test_RevertWhen_Impersonation() public {
        string[7] memory names = ["Bitcoin Gold", "My ETHER coin", "Qore Chain Cash", "USDT Plus", "Doge coin", "Pepe Classic", "Real Solana"];
        for (uint256 i = 0; i < names.length; i++) {
            vm.prank(alice);
            vm.expectPartialRevert(QrowCoinFactory.Impersonation.selector);
            factory.launch(names[i], "NICE", 1_000, 0, "", _validUntil(), "");
        }
        string[7] memory symbols = ["BTC", "WBTC", "FETH", "FUSD", "QORX", "DOGE", "USDC"];
        for (uint256 i = 0; i < symbols.length; i++) {
            vm.prank(alice);
            vm.expectPartialRevert(QrowCoinFactory.Impersonation.selector);
            factory.launch("Harmless Name", symbols[i], 1_000, 0, "", _validUntil(), "");
        }
    }

    function test_CheckNamesView() public view {
        (bool ok,) = factory.checkNames("Paper Lantern", "LANT");
        assertTrue(ok);
        (bool bad, string memory why) = factory.checkNames("Ethereum Max", "EMAX");
        assertFalse(bad);
        assertEq(why, "ethereum");
        (bool bad2, string memory why2) = factory.checkNames("Nice Name", "DOGE");
        assertFalse(bad2);
        assertEq(why2, "DOGE");
    }

    function test_DuplicateSymbolCountedNotBlocked() public {
        _launch(alice, "Lantern One", "LANT", 1_000, 0);
        _launch(bob, "Lantern Two", "LANT", 1_000, 0);
        assertEq(factory.symbolCount(keccak256("LANT")), 2);
    }

    function test_ClaimOncePerAddress() public {
        QrowCoin c = _launch(alice, "Paper Lantern", "LANT", 1_000_000, 1_000);
        uint256 got = _claim(c, bob);
        assertEq(got, 900 ether); // 900,000 / 1000
        assertEq(c.balanceOf(bob), 900 ether);
        vm.prank(bob);
        vm.expectRevert(QrowCoin.AlreadyClaimed.selector);
        c.claim(_validUntil(), "");
    }

    function test_ClaimDrainsToZeroThenStops() public {
        QrowCoin c = _launch(alice, "Small Pool", "SMOL", 1_000, 0);
        for (uint256 i = 0; i < 1000; i++) {
            address a = address(uint160(0x10000 + i));
            _registerKey(a);
            _claim(c, a);
        }
        assertEq(c.balanceOf(address(c)), 0);
        address late = makeAddr("late");
        _registerKey(late);
        vm.prank(late);
        vm.expectRevert(QrowCoin.PoolEmpty.selector);
        c.claim(_validUntil(), "");
    }

    function test_NoOwnerPowersExist() public {
        QrowCoin c = _launch(alice, "Paper Lantern", "LANT", 1_000_000, 1_000);
        bytes4[7] memory sels = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("mint(address,uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("blacklist(address)")),
            bytes4(keccak256("setFee(uint256)")),
            bytes4(keccak256("burn(uint256)")),
            bytes4(keccak256("transferOwnership(address)"))
        ];
        for (uint256 i = 0; i < sels.length; i++) {
            vm.prank(alice);
            (bool ok,) = address(c).call(abi.encodeWithSelector(sels[i], alice, 1));
            assertFalse(ok);
        }
        assertEq(c.totalSupply(), 1_000_000 ether); // still fixed
    }

    function test_TransfersAreStandard() public {
        QrowCoin c = _launch(alice, "Paper Lantern", "LANT", 1_000_000, 1_000);
        vm.prank(alice);
        c.transfer(bob, 1 ether);
        assertEq(c.balanceOf(bob), 1 ether);
    }

    // ---------------------------------------------------------------- Q-Day: leaked ECDSA key

    function test_Leaked_CannotLaunchAsVictim() public {
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        factory.launch("Rug Pull", "RUG", 1_000, 1_000, "", _validUntil(), _forgedSig());
        assertEq(factory.coinCount(), 0);
    }

    function test_Leaked_CannotClaimAsVictim() public {
        QrowCoin c = _launch(alice, "Paper Lantern", "LANT", 1_000_000, 1_000);
        vm.prank(bob);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        c.claim(_validUntil(), _forgedSig());
        assertFalse(c.claimed(bob));
    }

    function test_RevertWhen_ClaimWithoutPqKey() public {
        QrowCoin c = _launch(alice, "Paper Lantern", "LANT", 1_000_000, 1_000);
        address noKey = makeAddr("nokey");
        vm.prank(noKey);
        vm.expectRevert(PqAuth.NoPqKey.selector);
        c.claim(_validUntil(), _forgedSig());
    }
}
