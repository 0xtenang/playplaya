// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title DNDVault
/// @notice Holds every DND that is inside the game.
///
/// Going in: a player calls deposit, and the game credits whoever owns the sending wallet.
///
/// Coming out: the game signs a voucher, and the player submits it to claim here, paying their
/// own gas. The game server holds a signing key but never holds tokens or sends transactions.
///
/// If that signing key is ever stolen, the thief can take at most dailyLimit per day, and the
/// owner can pause the vault and replace the signer. The owner should be a hardware wallet or
/// a multisig, kept away from the game server.
contract DNDVault {
    uint256 private constant UNIT = 1e18;
    // Half the curve order. Higher values are the malleable twin of a valid signature.
    uint256 private constant MAX_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;
    bytes32 private constant DOMAIN_TYPE = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CLAIM_TYPE = keccak256("Claim(address to,uint256 whole,bytes32 nonce,uint256 expiry)");

    IERC20Min public immutable token;
    address public owner;
    address public pendingOwner;
    address public signer;
    bool public paused;
    /// @notice The most that vouchers can pay out per UTC day, in whole tokens.
    uint256 public dailyLimit;

    mapping(bytes32 => bool) public used;
    mapping(uint256 => uint256) public spentOnDay;

    event Deposited(address indexed from, uint256 whole);
    event Claimed(bytes32 indexed nonce, address indexed to, uint256 whole);
    event PausedSet(bool paused);
    event SignerChanged(address signer);
    event DailyLimitChanged(uint256 whole);
    event OwnerProposed(address owner);
    event OwnerChanged(address owner);
    event Rescued(address indexed to, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address token_, address owner_, address signer_, uint256 dailyLimit_) {
        require(token_ != address(0) && owner_ != address(0) && signer_ != address(0), "zero address");
        token = IERC20Min(token_);
        owner = owner_;
        signer = signer_;
        dailyLimit = dailyLimit_;
    }

    /// @notice Moves whole tokens into the game. The vault must be approved first.
    /// Tokens sent directly to this address, without calling this, are not credited to anyone.
    function deposit(uint256 whole) external {
        require(!paused, "paused");
        require(whole > 0, "zero amount");
        require(token.transferFrom(msg.sender, address(this), whole * UNIT), "transfer failed");
        emit Deposited(msg.sender, whole);
    }

    /// @notice Pays out a voucher signed by the game. Anyone may submit it, but only `to` is paid.
    function claim(address to, uint256 whole, bytes32 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) external {
        require(!paused, "paused");
        require(block.timestamp <= expiry, "expired");
        require(!used[nonce], "already claimed");
        require(uint256(s) <= MAX_S, "bad signature");
        address got = ecrecover(claimDigest(to, whole, nonce, expiry), v, r, s);
        require(got != address(0) && got == signer, "bad signature");

        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOnDay[day] + whole;
        require(spent <= dailyLimit, "daily limit");
        spentOnDay[day] = spent;
        used[nonce] = true;

        require(token.transfer(to, whole * UNIT), "transfer failed");
        emit Claimed(nonce, to, whole);
    }

    /// @notice What the signer signs. Bound to this chain and this vault, so a voucher cannot be
    /// replayed anywhere else.
    function claimDigest(address to, uint256 whole, bytes32 nonce, uint256 expiry) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPE, keccak256("DNDVault"), keccak256("1"), block.chainid, address(this)));
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPE, to, whole, nonce, expiry));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setSigner(address signer_) external onlyOwner {
        require(signer_ != address(0), "zero address");
        signer = signer_;
        emit SignerChanged(signer_);
    }

    function setDailyLimit(uint256 whole) external onlyOwner {
        dailyLimit = whole;
        emit DailyLimitChanged(whole);
    }

    /// @notice Last-resort recovery, only while paused. This is a real power over players' funds,
    /// and every use is public on the chain. Disclose it to players.
    function rescue(address to, uint256 value) external onlyOwner {
        require(paused, "not paused");
        require(token.transfer(to, value), "transfer failed");
        emit Rescued(to, value);
    }

    /// @notice Ownership moves in two steps, so a typo cannot lose control of the vault.
    function proposeOwner(address next) external onlyOwner {
        pendingOwner = next;
        emit OwnerProposed(next);
    }

    function acceptOwner() external {
        require(msg.sender == pendingOwner, "not proposed");
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnerChanged(msg.sender);
    }
}
