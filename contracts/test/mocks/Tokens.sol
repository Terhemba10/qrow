// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 for tests (stands in for fUSD / fETH / fBTC).
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Takes a 10% fee on every transfer.
contract FeeOnTransferToken is MockERC20 {
    constructor() MockERC20("Fee", "FEE") {}

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        uint256 fee = amount / 10;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        return true;
    }
}

/// @notice Returns false instead of reverting.
contract FalseToken is MockERC20 {
    constructor() MockERC20("False", "FALSE") {}

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

interface IReenterTarget {
    function refundExpired(uint256 id) external;
    function claim(uint256 id, uint64 validUntil, bytes calldata pqSig) external;
}

/// @notice ERC-20 whose transfer() tries to re-enter the escrow.
contract ReentrantToken is MockERC20 {
    address public target;
    uint256 public targetId;
    bool public armed;

    constructor() MockERC20("Reenter", "RE") {}

    function arm(address t, uint256 id) external {
        target = t;
        targetId = id;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            IReenterTarget(target).refundExpired(targetId);
        }
        return super.transfer(to, amount);
    }
}

/// @notice A contract account that refuses native QOR.
contract RejectingSender {
    bool public accept;

    receive() external payable {
        require(accept, "no thanks");
    }

    function exec(address target, uint256 value, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    /// @dev Accepts NFTs (so it can mint and sell Genesis tokens) while still refusing QOR.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function setAccept(bool a) external {
        accept = a;
    }
}

/// @notice Recipient contract that re-enters claim() when it receives QOR.
contract ReentrantRecipient {
    address public target;
    uint256 public id;
    uint64 public validUntil;
    bytes public sig;

    function prime(address t, uint256 i, uint64 v, bytes calldata s) external {
        target = t;
        id = i;
        validUntil = v;
        sig = s;
    }

    function doClaim() external {
        IReenterTarget(target).claim(id, validUntil, sig);
    }

    receive() external payable {
        IReenterTarget(target).claim(id, validUntil, sig);
    }
}
