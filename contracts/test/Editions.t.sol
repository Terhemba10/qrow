// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PqBase} from "./PqBase.t.sol";
import {PqAuth} from "../src/PqAuth.sol";
import {QrowEditions} from "../src/QrowEditions.sol";

contract EditionsTest is PqBase {
    QrowEditions internal e;
    string internal constant URI = "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

    function setUp() public override {
        super.setUp();
        e = new QrowEditions(address(fusd), "qorechain-diana", address(0));
        fusd.mint(bob, 1_000 ether);
        vm.prank(bob);
        fusd.approve(address(e), type(uint256).max);
    }

    function _create(address who, uint256 supply) internal returns (uint256) {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(e, who, e.ACTION_CREATE(), keccak256(abi.encode(keccak256(bytes(URI)), supply)), v);
        vm.prank(who);
        return e.create(URI, supply, v, sig);
    }

    function _list(address who, uint256 id, uint256 amount, uint256 price) internal returns (uint256) {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(e, who, e.ACTION_LIST(), keccak256(abi.encode(id, amount, price)), v);
        vm.prank(who);
        return e.list(id, amount, price, v, sig);
    }

    function _buy(address who, uint256 lid, uint256 amount) internal {
        QrowEditions.Listing memory l = e.getListing(lid);
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(e, who, e.ACTION_BUY(), keccak256(abi.encode(lid, l.editionId, amount, l.price)), v);
        vm.prank(who);
        e.buy(lid, amount, v, sig);
    }

    function test_createMintsAllCopiesToCreator() public {
        uint256 id = _create(alice, 25);
        assertEq(e.balanceOf(alice, id), 25);
        assertEq(e.uri(id), URI);
        assertEq(e.getEdition(id).creator, alice);
        (uint256[] memory ids, uint256[] memory bals) = e.holdings(alice, 1, 50);
        assertEq(ids.length, 1);
        assertEq(bals[0], 25);
    }

    function test_createRejectsBadSupplyAndForgedSig() public {
        uint64 v = _validUntil();
        vm.prank(alice);
        vm.expectRevert(QrowEditions.BadSupply.selector);
        e.create(URI, 0, v, _forgedSig());
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        e.create(URI, 5, v, _forgedSig());
    }

    function test_sendNeedsPqAndMovesCopies() public {
        uint256 id = _create(alice, 10);
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(e, alice, e.ACTION_SEND(), keccak256(abi.encode(bob, id, uint256(3))), v);
        vm.prank(alice);
        e.send(bob, id, 3, v, sig);
        assertEq(e.balanceOf(bob, id), 3);
        assertEq(e.balanceOf(alice, id), 7);
    }

    function test_plainTransfersAreOff() public {
        uint256 id = _create(alice, 2);
        vm.prank(alice);
        vm.expectRevert(QrowEditions.TransfersDisabled.selector);
        e.safeTransferFrom(alice, mallory, id, 1, "");
        vm.prank(alice);
        vm.expectRevert(QrowEditions.TransfersDisabled.selector);
        e.setApprovalForAll(mallory, true);
    }

    function test_listPartialBuyThenCancelReturnsRest() public {
        uint256 id = _create(alice, 10);
        uint256 lid = _list(alice, id, 4, 2e6);
        assertEq(e.balanceOf(alice, id), 6);
        assertEq(e.balanceOf(address(e), id), 4);
        uint256 before = fusd.balanceOf(alice);
        _buy(bob, lid, 3);
        assertEq(e.balanceOf(bob, id), 3);
        assertEq(fusd.balanceOf(alice) - before, 6e6);
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(e, alice, e.ACTION_CANCEL(), keccak256(abi.encode(lid)), v);
        vm.prank(alice);
        e.cancel(lid, v, sig);
        assertEq(e.balanceOf(alice, id), 7);
        assertEq(e.activeListingIds().length, 0);
    }

    function test_cannotBuyOwnOrMoreThanListed() public {
        uint256 id = _create(alice, 5);
        uint256 lid = _list(alice, id, 2, 1e6);
        uint64 v = _validUntil();
        vm.prank(alice);
        vm.expectRevert(QrowEditions.OwnListing.selector);
        e.buy(lid, 1, v, _forgedSig());
        vm.prank(bob);
        vm.expectRevert(QrowEditions.BadAmount.selector);
        e.buy(lid, 3, v, _forgedSig());
    }

    function test_onlySellerCancels() public {
        uint256 id = _create(alice, 5);
        uint256 lid = _list(alice, id, 2, 1e6);
        uint64 v = _validUntil();
        vm.prank(mallory);
        vm.expectRevert(QrowEditions.NotSeller.selector);
        e.cancel(lid, v, _forgedSig());
    }
}
