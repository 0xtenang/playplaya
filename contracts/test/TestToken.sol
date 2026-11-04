// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// @notice Stands in for a Pons token in tests. The real token comes from the Pons launchpad:
/// a fixed-supply ERC-20 with 18 decimals and a public burn function.
contract TestToken {
    string public constant name = "Test";
    string public constant symbol = "TEST";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

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

    function burn(uint256 value) external {
        uint256 balance = balanceOf[msg.sender];
        require(balance >= value, "balance");
        balanceOf[msg.sender] = balance - value;
        totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
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

/// @notice A token with no burn function, to prove the vault falls back to the dead address.
contract NoBurnToken {
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;

    constructor(uint256 whole, address holder) {
        balanceOf[holder] = whole * 1e18;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
}

/// @notice Skims 1% of every transfer, which would quietly leave the vault short.
contract TaxedToken {
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 whole, address holder) {
        balanceOf[holder] = whole * 1e18;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value - value / 100;
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value - value / 100;
        return true;
    }
}

/// @notice Has the wrong number of decimals for the vault's whole-token accounting.
contract SixDecimalToken {
    uint8 public constant decimals = 6;
}
