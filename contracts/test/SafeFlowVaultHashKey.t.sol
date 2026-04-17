// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeFlowVaultHashKey} from "../src/SafeFlowVaultHashKey.sol";

contract SafeFlowVaultHashKeyTest is Test {
    SafeFlowVaultHashKey public vault;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address recipient = makeAddr("recipient");

    uint256 constant MAX_PER_SEC = 1 ether; // 1 HSK per second
    uint256 constant MAX_TOTAL = 100 ether; // 100 HSK lifetime
    uint256 constant SESSION_TTL = 1 days;

    function setUp() public {
        vault = new SafeFlowVaultHashKey();
        vm.deal(owner, 1000 ether);
        vm.deal(agent, 1 ether); // gas only
    }

    // ======================== Vault Creation ========================

    function test_createVault() public {
        vm.prank(owner);
        uint256 vaultId = vault.createVault();
        assertEq(vaultId, 0);

        (address vOwner, uint256 vBalance, bool vExists) = vault.getVault(vaultId);
        assertEq(vOwner, owner);
        assertEq(vBalance, 0);
        assertTrue(vExists);
    }

    function test_createMultipleVaults() public {
        vm.startPrank(owner);
        uint256 id0 = vault.createVault();
        uint256 id1 = vault.createVault();
        vm.stopPrank();
        assertEq(id0, 0);
        assertEq(id1, 1);

        uint256[] memory ids = vault.getOwnerVaults(owner);
        assertEq(ids.length, 2);
    }

    // ======================== Deposit ========================

    function test_deposit() public {
        vm.prank(owner);
        uint256 vaultId = vault.createVault();

        vm.prank(owner);
        vault.deposit{value: 50 ether}(vaultId);

        (, uint256 bal,) = vault.getVault(vaultId);
        assertEq(bal, 50 ether);
    }

    function test_deposit_anyoneCanDeposit() public {
        vm.prank(owner);
        uint256 vaultId = vault.createVault();

        address funder = makeAddr("funder");
        vm.deal(funder, 10 ether);
        vm.prank(funder);
        vault.deposit{value: 5 ether}(vaultId);

        (, uint256 bal,) = vault.getVault(vaultId);
        assertEq(bal, 5 ether);
    }

    function test_deposit_revertZero() public {
        vm.prank(owner);
        uint256 vaultId = vault.createVault();

        vm.prank(owner);
        vm.expectRevert(SafeFlowVaultHashKey.ZeroAmount.selector);
        vault.deposit{value: 0}(vaultId);
    }

    function test_deposit_revertNotFound() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVaultHashKey.VaultNotFound.selector);
        vault.deposit{value: 1 ether}(999);
    }

    // ======================== Withdraw ========================

    function test_withdraw() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.deposit{value: 50 ether}(vaultId);
        vault.withdraw(vaultId, 20 ether);
        vm.stopPrank();

        (, uint256 bal,) = vault.getVault(vaultId);
        assertEq(bal, 30 ether);
    }

    function test_withdraw_revertNotOwner() public {
        vm.prank(owner);
        uint256 vaultId = vault.createVault();
        vm.prank(owner);
        vault.deposit{value: 50 ether}(vaultId);

        vm.prank(agent);
        vm.expectRevert(SafeFlowVaultHashKey.NotVaultOwner.selector);
        vault.withdraw(vaultId, 10 ether);
    }

    function test_withdraw_revertInsufficientBalance() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.deposit{value: 5 ether}(vaultId);
        vm.expectRevert(SafeFlowVaultHashKey.InsufficientBalance.selector);
        vault.withdraw(vaultId, 10 ether);
        vm.stopPrank();
    }

    // ======================== Session Management ========================

    function test_grantSession() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.grantSession(vaultId, agent, MAX_PER_SEC, MAX_TOTAL, block.timestamp + SESSION_TTL);
        vm.stopPrank();

        (uint256 mps, uint256 mt, uint256 ts,, uint256 exp, bool exists) = vault.getSession(vaultId, agent);
        assertEq(mps, MAX_PER_SEC);
        assertEq(mt, MAX_TOTAL);
        assertEq(ts, 0);
        assertTrue(exists);
        assertEq(exp, block.timestamp + SESSION_TTL);
    }

    function test_grantSession_revertNotOwner() public {
        vm.prank(owner);
        uint256 vaultId = vault.createVault();

        vm.prank(agent);
        vm.expectRevert(SafeFlowVaultHashKey.NotVaultOwner.selector);
        vault.grantSession(vaultId, agent, MAX_PER_SEC, MAX_TOTAL, block.timestamp + SESSION_TTL);
    }

    function test_grantSession_revertDuplicate() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.grantSession(vaultId, agent, MAX_PER_SEC, MAX_TOTAL, block.timestamp + SESSION_TTL);

        vm.expectRevert(SafeFlowVaultHashKey.SessionAlreadyExists.selector);
        vault.grantSession(vaultId, agent, MAX_PER_SEC, MAX_TOTAL, block.timestamp + SESSION_TTL);
        vm.stopPrank();
    }

    function test_revokeSession() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.grantSession(vaultId, agent, MAX_PER_SEC, MAX_TOTAL, block.timestamp + SESSION_TTL);
        vault.revokeSession(vaultId, agent);
        vm.stopPrank();

        (,,,,,bool exists) = vault.getSession(vaultId, agent);
        assertFalse(exists);
    }

    // ======================== Payment Execution ========================

    function _setupFundedVault() internal returns (uint256 vaultId) {
        vm.startPrank(owner);
        vaultId = vault.createVault();
        vault.deposit{value: 100 ether}(vaultId);
        vault.grantSession(vaultId, agent, MAX_PER_SEC, MAX_TOTAL, block.timestamp + SESSION_TTL);
        vm.stopPrank();
    }

    function test_executePayment() public {
        uint256 vaultId = _setupFundedVault();

        // Wait 10 seconds to accumulate rate allowance
        vm.warp(block.timestamp + 10);

        uint256 recipientBefore = recipient.balance;
        vm.prank(agent);
        vault.executePayment(vaultId, recipient, 5 ether, keccak256("test reasoning"), "test payment");

        assertEq(recipient.balance - recipientBefore, 5 ether);

        (, uint256 bal,) = vault.getVault(vaultId);
        assertEq(bal, 95 ether);

        (,, uint256 totalSpent,,,) = vault.getSession(vaultId, agent);
        assertEq(totalSpent, 5 ether);
    }

    function test_executePayment_revertRateLimit() public {
        uint256 vaultId = _setupFundedVault();

        // Only 2 seconds elapsed → max 2 HSK allowed
        vm.warp(block.timestamp + 2);

        vm.prank(agent);
        vm.expectRevert(SafeFlowVaultHashKey.ExceedsRateLimit.selector);
        vault.executePayment(vaultId, recipient, 5 ether, keccak256("x"), "over rate");
    }

    function test_executePayment_revertTotalLimit() public {
        uint256 vaultId = _setupFundedVault();

        // Warp far enough for rate, but exceed total limit
        vm.warp(block.timestamp + 200);

        vm.prank(agent);
        vm.expectRevert(SafeFlowVaultHashKey.ExceedsTotalLimit.selector);
        vault.executePayment(vaultId, recipient, 101 ether, keccak256("x"), "over total");
    }

    function test_executePayment_revertExpired() public {
        uint256 vaultId = _setupFundedVault();

        // Warp past expiry
        vm.warp(block.timestamp + SESSION_TTL + 1);

        vm.prank(agent);
        vm.expectRevert(SafeFlowVaultHashKey.SessionExpired.selector);
        vault.executePayment(vaultId, recipient, 1 ether, keccak256("x"), "expired");
    }

    function test_executePayment_revertInsufficientBalance() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.deposit{value: 1 ether}(vaultId);
        vault.grantSession(vaultId, agent, MAX_PER_SEC, MAX_TOTAL, block.timestamp + SESSION_TTL);
        vm.stopPrank();

        vm.warp(block.timestamp + 10);

        vm.prank(agent);
        vm.expectRevert(SafeFlowVaultHashKey.InsufficientBalance.selector);
        vault.executePayment(vaultId, recipient, 5 ether, keccak256("x"), "no funds");
    }

    function test_executePayment_revertNoSession() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.deposit{value: 100 ether}(vaultId);
        vm.stopPrank();

        address rogue = makeAddr("rogue");
        vm.prank(rogue);
        vm.expectRevert(SafeFlowVaultHashKey.SessionNotFound.selector);
        vault.executePayment(vaultId, recipient, 1 ether, keccak256("x"), "no session");
    }

    function test_executePayment_afterRevoke() public {
        uint256 vaultId = _setupFundedVault();

        vm.prank(owner);
        vault.revokeSession(vaultId, agent);

        vm.warp(block.timestamp + 10);

        vm.prank(agent);
        vm.expectRevert(SafeFlowVaultHashKey.SessionNotFound.selector);
        vault.executePayment(vaultId, recipient, 1 ether, keccak256("x"), "revoked");
    }

    // ======================== View: getAvailableAllowance ========================

    function test_getAvailableAllowance() public {
        uint256 vaultId = _setupFundedVault();

        vm.warp(block.timestamp + 5);
        uint256 available = vault.getAvailableAllowance(vaultId, agent);
        assertEq(available, 5 ether); // 5 sec * 1 HSK/sec
    }

    function test_getAvailableAllowance_cappedByTotal() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.deposit{value: 1000 ether}(vaultId);
        // totalMax = 10 ether, rate = 100 ether/sec
        vault.grantSession(vaultId, agent, 100 ether, 10 ether, block.timestamp + SESSION_TTL);
        vm.stopPrank();

        vm.warp(block.timestamp + 100);
        uint256 available = vault.getAvailableAllowance(vaultId, agent);
        assertEq(available, 10 ether); // capped by total
    }

    function test_getAvailableAllowance_cappedByBalance() public {
        vm.startPrank(owner);
        uint256 vaultId = vault.createVault();
        vault.deposit{value: 2 ether}(vaultId);
        vault.grantSession(vaultId, agent, MAX_PER_SEC, MAX_TOTAL, block.timestamp + SESSION_TTL);
        vm.stopPrank();

        vm.warp(block.timestamp + 100);
        uint256 available = vault.getAvailableAllowance(vaultId, agent);
        assertEq(available, 2 ether); // capped by vault balance
    }

    // ======================== Event emission ========================

    function test_paymentEvent() public {
        uint256 vaultId = _setupFundedVault();
        vm.warp(block.timestamp + 10);

        bytes32 reason = keccak256("AI reasoning payload");
        vm.expectEmit(true, true, true, true);
        emit SafeFlowVaultHashKey.PaymentExecuted(vaultId, agent, recipient, 3 ether, reason, "buy API");

        vm.prank(agent);
        vault.executePayment(vaultId, recipient, 3 ether, reason, "buy API");
    }
}
