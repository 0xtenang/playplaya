// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// @title DND
/// @notice A plain, fixed-supply ERC-20. Every token exists from the moment of deployment.
/// There is no owner, no minting, no burning, no pausing and no upgrade path.
contract DNDToken {
    string public constant name = "DND";
    string public constant symbol = "DND";
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @param wholeTokens Total supply in whole tokens, not base units.
    /// @param holder Receives the entire supply.
    constructor(uint256 wholeTokens, address holder) {
        require(holder != address(0), "zero holder");
        require(wholeTokens > 0, "zero supply");
        totalSupply = wholeTokens * 1e18;
        balanceOf[holder] = totalSupply;
        emit Transfer(address(0), holder, totalSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) private {
        require(to != address(0), "zero recipient");
        uint256 balance = balanceOf[from];
        require(balance >= value, "balance");
        unchecked {
            // Cannot overflow: the sum of all balances is the fixed total supply.
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
