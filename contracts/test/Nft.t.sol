// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PqBase} from "./PqBase.t.sol";
import {PqAuth} from "../src/PqAuth.sol";
import {QrowGenesis} from "../src/QrowGenesis.sol";
import {QrowMarket} from "../src/QrowMarket.sol";
import {MockERC20, RejectingSender} from "./mocks/Tokens.sol";

abstract contract NftBase is PqBase {
    QrowGenesis internal genesis;
    QrowMarket internal market;
    address internal beneficiary = makeAddr("beneficiary");
    uint256 internal constant PRICE_QOR = 2 ether;
    uint256 internal constant PRICE_FUSD = 5 ether; // the mock has 18 decimals

    function setUp() public virtual override {
        super.setUp();
        address predictedMarket = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        genesis = new QrowGenesis(predictedMarket, beneficiary, address(fusd), PRICE_QOR, PRICE_FUSD, "qorechain-diana");
        market = new QrowMarket(address(genesis), address(fusd), "qorechain-diana");
        assertEq(address(market), predictedMarket);

        fusd.mint(bob, 1_000 ether);
        vm.prank(alice);
        fusd.approve(address(genesis), type(uint256).max);
        vm.prank(bob);
        fusd.approve(address(market), type(uint256).max);
    }

    function _mint(address who, address currency) internal returns (uint256 id) {
        uint64 v = _validUntil();
        uint256 price = currency == address(0) ? PRICE_QOR : PRICE_FUSD;
        bytes memory sig = _pqSig(genesis, who, genesis.ACTION_MINT(), keccak256(abi.encode(currency, price)), v);
        vm.prank(who);
        id = genesis.mint{value: currency == address(0) ? PRICE_QOR : 0}(currency, v, sig);
    }

    function _list(address who, uint256 tokenId, address currency, uint256 price) internal returns (uint256 id) {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(market, who, market.ACTION_LIST(), keccak256(abi.encode(tokenId, currency, price)), v);
        vm.prank(who);
        id = market.list(tokenId, currency, price, v, sig);
    }

    function _buy(address who, uint256 id) internal {
        QrowMarket.Listing memory l = market.getListing(id);
        uint64 v = _validUntil();
        bytes memory sig =
            _pqSig(market, who, market.ACTION_BUY(), keccak256(abi.encode(id, l.tokenId, l.currency, l.price)), v);
        vm.prank(who);
        market.buy{value: l.currency == address(0) ? l.price : 0}(id, v, sig);
    }

    function _cancelListing(address who, uint256 id) internal {
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(market, who, market.ACTION_CANCEL(), keccak256(abi.encode(id)), v);
        vm.prank(who);
        market.cancel(id, v, sig);
    }
}

contract GenesisTest is NftBase {
    function test_MintWithQor() public {
        uint256 id = _mint(alice, address(0));
        assertEq(id, 1);
        assertEq(genesis.ownerOf(1), alice);
        assertEq(beneficiary.balance, PRICE_QOR);
        assertEq(address(genesis).balance, 0);
        assertEq(genesis.mintedBy(alice), 1);
    }

    function test_MintWithFusd() public {
        _mint(alice, address(fusd));
        assertEq(fusd.balanceOf(beneficiary), PRICE_FUSD);
        assertEq(fusd.balanceOf(address(genesis)), 0);
    }

    function test_RevertWhen_WrongValueOrCurrency() public {
        uint64 v = _validUntil();
        vm.prank(alice);
        vm.expectRevert(QrowGenesis.BadValue.selector);
        genesis.mint{value: 1 ether}(address(0), v, "");
        vm.prank(alice);
        vm.expectRevert(QrowGenesis.BadValue.selector);
        genesis.mint{value: 1}(address(fusd), v, "");
        vm.prank(alice);
        vm.expectRevert(QrowGenesis.BadCurrency.selector);
        genesis.mint(makeAddr("other-token"), v, "");
    }

    function test_RevertWhen_MintWithoutPq() public {
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        genesis.mint{value: PRICE_QOR}(address(0), _validUntil(), _forgedSig());
    }

    function test_RevertWhen_WalletLimit() public {
        for (uint256 i = 0; i < 5; i++) _mint(alice, address(0));
        uint64 v = _validUntil();
        vm.prank(alice);
        vm.expectRevert(QrowGenesis.WalletLimit.selector);
        genesis.mint{value: PRICE_QOR}(address(0), v, "");
    }

    function test_RevertWhen_SoldOut() public {
        vm.store(address(genesis), bytes32(uint256(_totalMintedSlot())), bytes32(uint256(256)));
        assertEq(genesis.totalMinted(), 256);
        vm.prank(alice);
        vm.expectRevert(QrowGenesis.SoldOut.selector);
        genesis.mint{value: PRICE_QOR}(address(0), _validUntil(), "");
    }

    function _totalMintedSlot() internal returns (uint256 slot) {
        // Find the storage slot that holds totalMinted by probing.
        for (slot = 0; slot < 30; slot++) {
            bytes32 before = vm.load(address(genesis), bytes32(slot));
            vm.store(address(genesis), bytes32(slot), bytes32(uint256(77)));
            bool hit = genesis.totalMinted() == 77;
            vm.store(address(genesis), bytes32(slot), before);
            if (hit) return slot;
        }
        revert("slot not found");
    }

    function test_PlainTransfersAndApprovalsAreRefused() public {
        _mint(alice, address(0));
        vm.startPrank(alice);
        vm.expectRevert(QrowGenesis.TransfersNeedPq.selector);
        genesis.transferFrom(alice, bob, 1);
        vm.expectRevert(QrowGenesis.TransfersNeedPq.selector);
        genesis.safeTransferFrom(alice, bob, 1);
        vm.expectRevert(QrowGenesis.ApprovalsDisabled.selector);
        genesis.approve(bob, 1);
        vm.expectRevert(QrowGenesis.ApprovalsDisabled.selector);
        genesis.setApprovalForAll(bob, true);
        vm.stopPrank();
        assertEq(genesis.ownerOf(1), alice);
    }

    function test_PqTransfer() public {
        _mint(alice, address(0));
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(genesis, alice, genesis.ACTION_TRANSFER(), keccak256(abi.encode(bob, uint256(1))), v);
        vm.prank(alice);
        genesis.pqTransfer(bob, 1, v, sig);
        assertEq(genesis.ownerOf(1), bob);
    }

    function test_RevertWhen_PqTransferNotOwnerOrBadTarget() public {
        _mint(alice, address(0));
        vm.prank(bob);
        vm.expectRevert(QrowGenesis.NotOwner.selector);
        genesis.pqTransfer(bob, 1, _validUntil(), "");
        vm.prank(alice);
        vm.expectRevert(QrowGenesis.BadRecipient.selector);
        genesis.pqTransfer(address(genesis), 1, _validUntil(), "");
    }

    function test_RevertWhen_MarketMoveByAnyoneElse() public {
        _mint(alice, address(0));
        vm.prank(mallory);
        vm.expectRevert(QrowGenesis.NotMarket.selector);
        genesis.marketMove(alice, mallory, 1);
    }

    function test_TokenUriIsOnChainJson() public {
        _mint(alice, address(0));
        string memory uri = genesis.tokenURI(1);
        assertEq(_prefix(bytes(uri), 29), "data:application/json;base64,");
        assertGt(bytes(uri).length, 500);
    }

    function test_Leaked_CannotMovePlainOrPq() public {
        _mint(alice, address(0));
        vm.startPrank(alice); // attacker holds alice's ECDSA key
        vm.expectRevert(QrowGenesis.TransfersNeedPq.selector);
        genesis.transferFrom(alice, mallory, 1);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        genesis.pqTransfer(mallory, 1, _validUntil(), _forgedSig());
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        genesis.mint(address(fusd), _validUntil(), _forgedSig()); // spending alice's fUSD approval
        vm.stopPrank();
        assertEq(genesis.ownerOf(1), alice);
        assertEq(fusd.balanceOf(alice), 1_000 ether);
    }

    function _prefix(bytes memory b, uint256 n) internal pure returns (string memory) {
        bytes memory out = new bytes(n);
        for (uint256 i = 0; i < n; i++) out[i] = b[i];
        return string(out);
    }
}

contract MarketTest is NftBase {
    function test_ListEscrowsTheNft() public {
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(0), 3 ether);
        assertEq(genesis.ownerOf(1), address(market));
        QrowMarket.Listing memory l = market.getListing(id);
        assertEq(l.seller, alice);
        assertTrue(l.active);
        assertEq(market.activeListingIds().length, 1);
    }

    function test_BuyWithQorPaysSellerAtomically() public {
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(0), 3 ether);
        uint256 before = alice.balance;
        _buy(bob, id);
        assertEq(genesis.ownerOf(1), bob);
        assertEq(alice.balance, before + 3 ether);
        assertEq(address(market).balance, 0);
        assertFalse(market.getListing(id).active);
        assertEq(market.activeListingIds().length, 0);
    }

    function test_BuyWithFusd() public {
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(fusd), 7e6); // 7 fUSD at 6 decimals
        uint256 before = fusd.balanceOf(alice);
        _buy(bob, id);
        assertEq(fusd.balanceOf(alice), before + 7e6);
        assertEq(genesis.ownerOf(1), bob);
    }

    function test_CancelReturnsNft() public {
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(0), 3 ether);
        _cancelListing(alice, id);
        assertEq(genesis.ownerOf(1), alice);
        assertFalse(market.getListing(id).active);
    }

    function test_FloorPrice() public {
        _mint(alice, address(0));
        _mint(alice, address(0));
        _mint(alice, address(0));
        _list(alice, 1, address(0), 5 ether);
        uint256 cheap = _list(alice, 2, address(0), 2 ether);
        _list(alice, 3, address(fusd), 1e6);
        (uint256 floor, uint256 lid) = market.floorPrice(address(0));
        assertEq(floor, 2 ether);
        assertEq(lid, cheap);
        (uint256 ffloor,) = market.floorPrice(address(fusd));
        assertEq(ffloor, 1e6);
        _buy(bob, cheap);
        (floor,) = market.floorPrice(address(0));
        assertEq(floor, 5 ether);
    }

    function test_RevertWhen_ListNotOwnerBadCurrencyBadPrice() public {
        _mint(alice, address(0));
        vm.prank(bob);
        vm.expectRevert(QrowMarket.NotTokenOwner.selector);
        market.list(1, address(0), 1 ether, _validUntil(), "");
        vm.startPrank(alice);
        vm.expectRevert(QrowMarket.BadCurrency.selector);
        market.list(1, makeAddr("x"), 1 ether, _validUntil(), "");
        vm.expectRevert(QrowMarket.BadPrice.selector);
        market.list(1, address(0), 0, _validUntil(), "");
        vm.expectRevert(QrowMarket.BadPrice.selector);
        market.list(1, address(0), 1_000_001 ether, _validUntil(), "");
        vm.stopPrank();
    }

    function test_RevertWhen_BuyOwnInactiveUnknownWrongValue() public {
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(0), 3 ether);
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        vm.expectRevert(QrowMarket.OwnListing.selector);
        market.buy{value: 3 ether}(id, _validUntil(), "");
        vm.prank(bob);
        vm.expectRevert(QrowMarket.BadValue.selector);
        market.buy{value: 1 ether}(id, _validUntil(), "");
        vm.prank(bob);
        vm.expectRevert(QrowMarket.UnknownListing.selector);
        market.buy(99, _validUntil(), "");
        _cancelListing(alice, id);
        vm.prank(bob);
        vm.expectRevert(QrowMarket.NotActive.selector);
        market.buy{value: 3 ether}(id, _validUntil(), "");
    }

    function test_RevertWhen_CancelByOther() public {
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(0), 3 ether);
        vm.prank(bob);
        vm.expectRevert(QrowMarket.NotSeller.selector);
        market.cancel(id, _validUntil(), "");
    }

    function test_BuySignatureBindsThePrice() public {
        // A buyer signs for listing #1 at 3 QOR; a signature for another price never verifies.
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(0), 3 ether);
        uint64 v = _validUntil();
        bytes memory cheapSig =
            _pqSig(market, bob, market.ACTION_BUY(), keccak256(abi.encode(id, uint256(1), address(0), uint256(1 ether))), v);
        vm.prank(bob);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        market.buy{value: 3 ether}(id, v, cheapSig);
    }

    function test_SellerRejectingQorIsCredited() public {
        RejectingSender rs = new RejectingSender();
        _registerKey(address(rs));
        vm.deal(address(rs), 10 ether);
        uint64 v = _validUntil();
        bytes memory msig = _pqSig(genesis, address(rs), genesis.ACTION_MINT(), keccak256(abi.encode(address(0), PRICE_QOR)), v);
        rs.exec(address(genesis), PRICE_QOR, abi.encodeCall(QrowGenesis.mint, (address(0), v, msig)));
        bytes memory lsig = _pqSig(market, address(rs), market.ACTION_LIST(), keccak256(abi.encode(uint256(1), address(0), uint256(3 ether))), v);
        rs.exec(address(market), 0, abi.encodeCall(QrowMarket.list, (1, address(0), 3 ether, v, lsig)));
        _buy(bob, 1);
        assertEq(genesis.ownerOf(1), bob);
        assertEq(market.owedNative(address(rs)), 3 ether);
        rs.setAccept(true);
        rs.exec(address(market), 0, abi.encodeCall(QrowMarket.withdrawOwed, ()));
        assertEq(market.owedNative(address(rs)), 0);
    }

    function test_RevertWhen_MarketNotNamedByCollection() public {
        vm.expectRevert(QrowMarket.MarketMismatch.selector);
        new QrowMarket(address(genesis), address(fusd), "qorechain-diana");
    }

    // ---------------------------------------------------------------- Q-Day: leaked ECDSA key

    function test_Leaked_CannotListVictimsNft() public {
        _mint(alice, address(0));
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        market.list(1, address(0), 1, _validUntil(), _forgedSig()); // list for 1 wei, then buy it
        assertEq(genesis.ownerOf(1), alice);
    }

    function test_Leaked_CannotCancelVictimsListing() public {
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(0), 3 ether);
        vm.prank(alice);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        market.cancel(id, _validUntil(), _forgedSig());
        assertEq(genesis.ownerOf(1), address(market));
    }

    function test_Leaked_CannotSpendVictimsFundsOnBuy() public {
        _mint(alice, address(0));
        uint256 id = _list(alice, 1, address(fusd), 7e6);
        vm.prank(bob); // bob's ECDSA key leaked; his fUSD is approved to the market
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        market.buy(id, _validUntil(), _forgedSig());
        assertEq(fusd.balanceOf(bob), 1_000 ether);
    }

    function test_Leaked_CannotReplayAnObservedBuy() public {
        _mint(alice, address(0));
        _mint(alice, address(0));
        uint256 id1 = _list(alice, 1, address(0), 3 ether);
        uint256 id2 = _list(alice, 2, address(0), 3 ether);
        QrowMarket.Listing memory l = market.getListing(id1);
        uint64 v = _validUntil();
        bytes memory sig = _pqSig(market, bob, market.ACTION_BUY(), keccak256(abi.encode(id1, l.tokenId, l.currency, l.price)), v);
        vm.prank(bob);
        market.buy{value: 3 ether}(id1, v, sig);
        vm.prank(bob);
        vm.expectRevert(PqAuth.BadPqSignature.selector);
        market.buy{value: 3 ether}(id2, v, sig); // same signature, other listing
    }

    function testFuzz_FloorIsMinimum(uint64 a, uint64 b, uint64 c) public {
        vm.assume(a > 0 && b > 0 && c > 0);
        for (uint256 i = 0; i < 3; i++) _mint(alice, address(0));
        _list(alice, 1, address(0), a);
        _list(alice, 2, address(0), b);
        _list(alice, 3, address(0), c);
        (uint256 floor,) = market.floorPrice(address(0));
        uint256 m = a < b ? a : b;
        m = m < c ? m : c;
        assertEq(floor, m);
    }
}
