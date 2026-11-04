// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {TestToken, NoBurnToken, TaxedToken, SixDecimalToken} from "./TestToken.sol";
import {DNDVault} from "../src/DNDVault.sol";

// Only the Foundry cheatcodes these tests use, so the suite needs no extra libraries.
interface Vm {
    function addr(uint256 key) external pure returns (address);
    function sign(uint256 key, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address who) external;
    function warp(uint256 time) external;
    function chainId(uint256 id) external;
    function assume(bool ok) external pure;
    function expectRevert(bytes calldata data) external;
}

contract VaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant UNIT = 1e18;
    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant THIEF_KEY = 0xBAD;
    uint256 private constant DAILY = 1_000;
    uint256 private constant BURN_DAILY = 2_000;
    address private constant OWNER = address(0xCAFE);
    address private constant PLAYER = address(0xB0B);
    address private constant OTHER = address(0xD00D);

    TestToken private token;
    DNDVault private vault;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new TestToken(1_000_000, OWNER);
        vault = new DNDVault(address(token), OWNER, vm.addr(SIGNER_KEY), DAILY, BURN_DAILY);
        vm.prank(OWNER);
        token.transfer(address(vault), 100_000 * UNIT);
        vm.prank(OWNER);
        token.transfer(PLAYER, 5_000 * UNIT);
    }

    function _sig(uint256 key, address to, uint256 whole, bytes32 nonce, uint256 expiry) private view returns (uint8, bytes32, bytes32) {
        return vm.sign(key, vault.claimDigest(to, whole, nonce, expiry));
    }

    function _claim(uint256 key, address to, uint256 whole, bytes32 nonce, uint256 expiry) private {
        (uint8 v, bytes32 r, bytes32 s) = _sig(key, to, whole, nonce, expiry);
        vault.claim(to, whole, nonce, expiry, v, r, s);
    }

    function _eq(uint256 a, uint256 b) private pure {
        require(a == b, "values differ");
    }

    // ------------------------------------------------------------ token
    function test_token_supply_is_fixed_and_held() public view {
        _eq(token.totalSupply(), 1_000_000 * UNIT);
        _eq(token.balanceOf(OWNER) + token.balanceOf(address(vault)) + token.balanceOf(PLAYER), token.totalSupply());
    }

    function test_token_cannot_overspend_balance_or_allowance() public {
        vm.prank(PLAYER);
        vm.expectRevert(bytes("balance"));
        token.transfer(OTHER, 5_001 * UNIT);
        vm.expectRevert(bytes("allowance"));
        token.transferFrom(PLAYER, OTHER, 1);
    }

    // ------------------------------------------------------------ deposits
    function test_deposit_moves_exact_whole_tokens() public {
        vm.prank(PLAYER);
        token.approve(address(vault), 25 * UNIT);
        vm.prank(PLAYER);
        vault.deposit(25);
        _eq(token.balanceOf(PLAYER), 4_975 * UNIT);
        _eq(token.balanceOf(address(vault)), 100_025 * UNIT);
    }

    function test_deposit_needs_approval() public {
        vm.prank(PLAYER);
        vm.expectRevert(bytes("allowance"));
        vault.deposit(1);
    }

    function test_deposit_refuses_zero_and_paused() public {
        vm.prank(PLAYER);
        vm.expectRevert(bytes("zero amount"));
        vault.deposit(0);
        vm.prank(OWNER);
        vault.setPaused(true);
        vm.prank(PLAYER);
        vm.expectRevert(bytes("paused"));
        vault.deposit(1);
    }

    // ------------------------------------------------------------ vouchers
    function test_claim_pays_the_named_wallet_even_if_someone_else_submits() public {
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60);
        vm.prank(OTHER);
        vault.claim(PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60, v, r, s);
        _eq(token.balanceOf(PLAYER), 5_040 * UNIT);
        _eq(token.balanceOf(OTHER), 0);
    }

    function test_voucher_cannot_be_used_twice() public {
        _claim(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60);
        vm.expectRevert(bytes("already claimed"));
        vault.claim(PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60, v, r, s);
    }

    function test_voucher_expires() public {
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), expiry);
        vm.warp(expiry + 1);
        vm.expectRevert(bytes("expired"));
        vault.claim(PLAYER, 40, bytes32(uint256(1)), expiry, v, r, s);
    }

    function test_forged_signature_is_refused() public {
        (uint8 v, bytes32 r, bytes32 s) = _sig(THIEF_KEY, PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60);
        vm.expectRevert(bytes("bad signature"));
        vault.claim(PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60, v, r, s);
    }

    function test_changed_voucher_details_are_refused(address to, uint256 whole, bytes32 nonce, uint256 extra) public {
        uint256 expiry = block.timestamp + 60;
        vm.assume(to != address(0) && to != PLAYER);
        vm.assume(whole != 40 && whole <= DAILY);
        vm.assume(nonce != bytes32(uint256(1)));
        extra = 1 + (extra % 1000);
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), expiry);
        vm.expectRevert(bytes("bad signature"));
        vault.claim(to, 40, bytes32(uint256(1)), expiry, v, r, s);
        vm.expectRevert(bytes("bad signature"));
        vault.claim(PLAYER, whole, bytes32(uint256(1)), expiry, v, r, s);
        vm.expectRevert(bytes("bad signature"));
        vault.claim(PLAYER, 40, nonce, expiry, v, r, s);
        vm.expectRevert(bytes("bad signature"));
        vault.claim(PLAYER, 40, bytes32(uint256(1)), expiry + extra, v, r, s);
    }

    function test_voucher_for_another_chain_is_refused() public {
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), expiry);
        vm.chainId(999_999);
        vm.expectRevert(bytes("bad signature"));
        vault.claim(PLAYER, 40, bytes32(uint256(1)), expiry, v, r, s);
    }

    function test_voucher_for_another_vault_is_refused() public {
        DNDVault twin = new DNDVault(address(token), OWNER, vm.addr(SIGNER_KEY), DAILY, BURN_DAILY);
        vm.prank(OWNER);
        token.transfer(address(twin), 1_000 * UNIT);
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), expiry);
        vm.expectRevert(bytes("bad signature"));
        twin.claim(PLAYER, 40, bytes32(uint256(1)), expiry, v, r, s);
    }

    function test_malleable_signature_is_refused() public {
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), expiry);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 flipped = bytes32(n - uint256(s));
        vm.expectRevert(bytes("bad signature"));
        vault.claim(PLAYER, 40, bytes32(uint256(1)), expiry, v == 27 ? 28 : 27, r, flipped);
    }

    // ------------------------------------------------------------ the limit on a stolen key
    function test_daily_limit_caps_even_valid_vouchers() public {
        uint256 expiry = block.timestamp + 3 days;
        _claim(SIGNER_KEY, PLAYER, DAILY, bytes32(uint256(1)), expiry);
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 1, bytes32(uint256(2)), expiry);
        vm.expectRevert(bytes("daily limit"));
        vault.claim(PLAYER, 1, bytes32(uint256(2)), expiry, v, r, s);
        vm.warp(block.timestamp + 1 days);
        vault.claim(PLAYER, 1, bytes32(uint256(2)), expiry, v, r, s);
        _eq(token.balanceOf(PLAYER), (5_000 + DAILY + 1) * UNIT);
    }

    function test_no_day_can_ever_pay_more_than_the_limit(uint16[8] memory amounts) public {
        uint256 expiry = block.timestamp + 1 hours;
        uint256 paid = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 whole = amounts[i] % (DAILY + 50);
            (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, whole, bytes32(i + 1), expiry);
            try vault.claim(PLAYER, whole, bytes32(i + 1), expiry, v, r, s) { paid += whole; } catch {}
        }
        require(paid <= DAILY, "limit broken");
        _eq(token.balanceOf(PLAYER), (5_000 + paid) * UNIT);
    }

    function test_replacing_the_signer_kills_old_vouchers() public {
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), expiry);
        vm.prank(OWNER);
        vault.setSigner(vm.addr(THIEF_KEY));
        vm.expectRevert(bytes("bad signature"));
        vault.claim(PLAYER, 40, bytes32(uint256(1)), expiry, v, r, s);
    }

    function test_pause_stops_claims() public {
        vm.prank(OWNER);
        vault.setPaused(true);
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60);
        vm.expectRevert(bytes("paused"));
        vault.claim(PLAYER, 40, bytes32(uint256(1)), block.timestamp + 60, v, r, s);
    }

    // ------------------------------------------------------------ burning
    function _burnSig(uint256 key, uint256 whole, bytes32 nonce, uint256 expiry) private view returns (uint8, bytes32, bytes32) {
        return vm.sign(key, vault.burnDigest(whole, nonce, expiry));
    }

    function test_burn_really_reduces_total_supply_and_anyone_can_submit() public {
        uint256 supply = token.totalSupply();
        uint256 held = token.balanceOf(address(vault));
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _burnSig(SIGNER_KEY, 30, bytes32(uint256(9)), expiry);
        vm.prank(OTHER);
        vault.burn(30, bytes32(uint256(9)), expiry, v, r, s);
        _eq(token.totalSupply(), supply - 30 * UNIT);
        _eq(token.balanceOf(address(vault)), held - 30 * UNIT);
        _eq(token.balanceOf(OTHER), 0);
        _eq(vault.totalBurned(), 30);
    }

    function test_burn_voucher_cannot_be_used_twice_or_after_expiry() public {
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _burnSig(SIGNER_KEY, 30, bytes32(uint256(9)), expiry);
        vault.burn(30, bytes32(uint256(9)), expiry, v, r, s);
        vm.expectRevert(bytes("already claimed"));
        vault.burn(30, bytes32(uint256(9)), expiry, v, r, s);
        (v, r, s) = _burnSig(SIGNER_KEY, 30, bytes32(uint256(10)), expiry);
        vm.warp(expiry + 1);
        vm.expectRevert(bytes("expired"));
        vault.burn(30, bytes32(uint256(10)), expiry, v, r, s);
    }

    function test_forged_or_changed_burn_is_refused(uint256 whole) public {
        uint256 expiry = block.timestamp + 60;
        vm.assume(whole != 30 && whole <= BURN_DAILY);
        (uint8 v, bytes32 r, bytes32 s) = _burnSig(THIEF_KEY, 30, bytes32(uint256(9)), expiry);
        vm.expectRevert(bytes("bad signature"));
        vault.burn(30, bytes32(uint256(9)), expiry, v, r, s);
        (v, r, s) = _burnSig(SIGNER_KEY, 30, bytes32(uint256(9)), expiry);
        vm.expectRevert(bytes("bad signature"));
        vault.burn(whole, bytes32(uint256(9)), expiry, v, r, s);
    }

    function test_a_claim_signature_cannot_be_used_as_a_burn_or_the_reverse() public {
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = _sig(SIGNER_KEY, PLAYER, 30, bytes32(uint256(9)), expiry);
        vm.expectRevert(bytes("bad signature"));
        vault.burn(30, bytes32(uint256(9)), expiry, v, r, s);
        (v, r, s) = _burnSig(SIGNER_KEY, 30, bytes32(uint256(9)), expiry);
        vm.expectRevert(bytes("bad signature"));
        vault.claim(PLAYER, 30, bytes32(uint256(9)), expiry, v, r, s);
    }

    function test_burns_have_their_own_daily_limit_and_leave_claims_alone() public {
        uint256 expiry = block.timestamp + 3 days;
        (uint8 v, bytes32 r, bytes32 s) = _burnSig(SIGNER_KEY, BURN_DAILY, bytes32(uint256(1)), expiry);
        vault.burn(BURN_DAILY, bytes32(uint256(1)), expiry, v, r, s);
        (v, r, s) = _burnSig(SIGNER_KEY, 1, bytes32(uint256(2)), expiry);
        vm.expectRevert(bytes("daily limit"));
        vault.burn(1, bytes32(uint256(2)), expiry, v, r, s);
        _claim(SIGNER_KEY, PLAYER, DAILY, bytes32(uint256(3)), expiry);
        vm.warp(block.timestamp + 1 days);
        vault.burn(1, bytes32(uint256(2)), expiry, v, r, s);
        _eq(vault.totalBurned(), BURN_DAILY + 1);
    }

    function test_pause_stops_burns() public {
        vm.prank(OWNER);
        vault.setPaused(true);
        (uint8 v, bytes32 r, bytes32 s) = _burnSig(SIGNER_KEY, 1, bytes32(uint256(1)), block.timestamp + 60);
        vm.expectRevert(bytes("paused"));
        vault.burn(1, bytes32(uint256(1)), block.timestamp + 60, v, r, s);
    }

    function test_a_token_with_no_burn_goes_to_the_dead_address() public {
        NoBurnToken plain = new NoBurnToken(1_000, OWNER);
        DNDVault v2 = new DNDVault(address(plain), OWNER, vm.addr(SIGNER_KEY), DAILY, BURN_DAILY);
        vm.prank(OWNER);
        plain.transfer(address(v2), 100 * UNIT);
        uint256 expiry = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, v2.burnDigest(25, bytes32(uint256(1)), expiry));
        v2.burn(25, bytes32(uint256(1)), expiry, v, r, s);
        _eq(plain.balanceOf(address(0xdEaD)), 25 * UNIT);
        _eq(plain.balanceOf(address(v2)), 75 * UNIT);
    }

    // ------------------------------------------------------------ tokens the vault must refuse
    function test_a_taxed_token_cannot_be_deposited() public {
        TaxedToken taxed = new TaxedToken(1_000, PLAYER);
        DNDVault v2 = new DNDVault(address(taxed), OWNER, vm.addr(SIGNER_KEY), DAILY, BURN_DAILY);
        vm.prank(PLAYER);
        taxed.approve(address(v2), 10 * UNIT);
        vm.prank(PLAYER);
        vm.expectRevert(bytes("transfer taxed"));
        v2.deposit(10);
    }

    function test_a_token_without_18_decimals_is_refused() public {
        SixDecimalToken wrong = new SixDecimalToken();
        vm.expectRevert(bytes("needs 18 decimals"));
        new DNDVault(address(wrong), OWNER, vm.addr(SIGNER_KEY), DAILY, BURN_DAILY);
    }

    // ------------------------------------------------------------ owner powers
    function test_only_the_owner_has_owner_powers(address who) public {
        vm.assume(who != OWNER);
        vm.prank(who);
        vm.expectRevert(bytes("not owner"));
        vault.setPaused(true);
        vm.prank(who);
        vm.expectRevert(bytes("not owner"));
        vault.setSigner(who);
        vm.prank(who);
        vm.expectRevert(bytes("not owner"));
        vault.setDailyLimit(type(uint256).max);
        vm.prank(who);
        vm.expectRevert(bytes("not owner"));
        vault.setDailyBurnLimit(type(uint256).max);
        vm.prank(who);
        vm.expectRevert(bytes("not owner"));
        vault.rescue(who, 1);
        vm.prank(who);
        vm.expectRevert(bytes("not owner"));
        vault.proposeOwner(who);
    }

    function test_rescue_only_works_while_paused() public {
        vm.prank(OWNER);
        vm.expectRevert(bytes("not paused"));
        vault.rescue(OTHER, 1);
        vm.prank(OWNER);
        vault.setPaused(true);
        vm.prank(OWNER);
        vault.rescue(OTHER, 7 * UNIT);
        _eq(token.balanceOf(OTHER), 7 * UNIT);
    }

    function test_ownership_needs_both_sides() public {
        vm.prank(OTHER);
        vm.expectRevert(bytes("not proposed"));
        vault.acceptOwner();
        vm.prank(OWNER);
        vault.proposeOwner(OTHER);
        require(vault.owner() == OWNER, "moved too early");
        vm.prank(OTHER);
        vault.acceptOwner();
        require(vault.owner() == OTHER && vault.pendingOwner() == address(0), "did not move");
    }
}
