// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeFlowVault} from "../src/SafeFlowVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract SafeFlowVaultTest is Test {
    SafeFlowVault public vault;
    MockERC20 public usdc;

    address public owner = makeAddr("owner");
    address public agent = makeAddr("agent");
    address public recipient = makeAddr("recipient");

    uint256 public walletId;
    uint256 public capId;

    function setUp() public {
        vault = new SafeFlowVault();
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Owner creates wallet
        vm.startPrank(owner);
        walletId = vault.createWallet("Test Wallet");

        // Mint and deposit USDC
        usdc.mint(owner, 10_000e6);
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(walletId, address(usdc), 10_000e6);

        // Create session cap for agent: 1000 USDC per interval, 5000 total, 1 hour interval, expires in 1 day
        capId = vault.createSessionCap(
            walletId,
            agent,
            1000e6,         // maxSpendPerInterval
            5000e6,         // maxSpendTotal
            3600,           // intervalSeconds (1 hour)
            uint64(block.timestamp + 1 days), // expiresAt
            "Test Session"
        );
        vm.stopPrank();
    }

    function test_CreateWallet() public view {
        SafeFlowVault.Wallet memory w = vault.getWallet(walletId);
        assertEq(w.owner, owner);
        assertTrue(w.exists);
        assertEq(w.name, "Test Wallet");
    }

    function test_Deposit() public view {
        assertEq(vault.getBalance(walletId, address(usdc)), 10_000e6);
    }

    function test_Withdraw() public {
        vm.prank(owner);
        vault.withdraw(walletId, address(usdc), 1000e6);
        assertEq(vault.getBalance(walletId, address(usdc)), 9000e6);
        assertEq(usdc.balanceOf(owner), 1000e6);
    }

    function test_WithdrawRevertNotOwner() public {
        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.NotOwner.selector);
        vault.withdraw(walletId, address(usdc), 1000e6);
    }

    function test_SessionCapCreated() public view {
        SafeFlowVault.SessionCap memory cap = vault.getSessionCap(capId);
        assertEq(cap.walletId, walletId);
        assertEq(cap.agent, agent);
        assertEq(cap.maxSpendPerInterval, 1000e6);
        assertEq(cap.maxSpendTotal, 5000e6);
        assertTrue(cap.active);
        assertEq(cap.name, "Test Session");
    }

    function test_ExecuteDeposit() public {
        // Use recipient as a mock "vault" that just receives tokens via transfer
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 500e6);

        uint256 recipientBefore = usdc.balanceOf(recipient);

        vm.prank(agent);
        vault.executeDeposit(capId, address(usdc), 500e6, address(usdc), keccak256("evidence1"), callData);

        // Check cap state updated
        SafeFlowVault.SessionCap memory cap = vault.getSessionCap(capId);
        assertEq(cap.totalSpent, 500e6);

        // Check wallet balance decreased
        assertEq(vault.getBalance(walletId, address(usdc)), 9500e6);

        // Check recipient (mock vault) received tokens
        assertEq(usdc.balanceOf(recipient) - recipientBefore, 500e6);

        // Check remaining allowance
        (uint256 intervalRem, uint256 totalRem) = vault.getRemainingAllowance(capId);
        assertEq(intervalRem, 500e6);
        assertEq(totalRem, 4500e6);
    }

    function test_ExecuteDepositRevertExpired() public {
        // Warp past expiry
        vm.warp(block.timestamp + 2 days);

        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.SessionExpired.selector);
        vault.executeDeposit(capId, address(usdc), 100e6, address(usdc), keccak256("evidence"), "");
    }

    function test_ExecuteDepositRevertTotalLimit() public {
        // Try to exceed total limit in multiple calls
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 1000e6);

        vm.startPrank(agent);
        // First 5 calls of 1000 each should succeed with interval resets
        for (uint256 i = 0; i < 5; i++) {
            vm.warp(block.timestamp + 3601); // new interval
            vault.executeDeposit(capId, address(usdc), 1000e6, address(usdc), keccak256("evidence"), callData);
        }

        // 6th call should fail
        vm.warp(block.timestamp + 3601);
        vm.expectRevert(SafeFlowVault.ExceedsTotalLimit.selector);
        vault.executeDeposit(capId, address(usdc), 1000e6, address(usdc), keccak256("evidence"), callData);
        vm.stopPrank();
    }

    function test_ExecuteDepositRevertIntervalLimit() public {
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 600e6);

        vm.startPrank(agent);
        // First call of 600 succeeds
        vault.executeDeposit(capId, address(usdc), 600e6, address(usdc), keccak256("ev1"), callData);

        // Second call of 600 in same interval should fail (1200 > 1000 limit)
        vm.expectRevert(SafeFlowVault.ExceedsIntervalLimit.selector);
        vault.executeDeposit(capId, address(usdc), 600e6, address(usdc), keccak256("ev2"), callData);
        vm.stopPrank();
    }

    function test_RevokeSessionCap() public {
        vm.prank(owner);
        vault.revokeSessionCap(capId);

        SafeFlowVault.SessionCap memory cap = vault.getSessionCap(capId);
        assertFalse(cap.active);

        // Agent can no longer execute
        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.SessionCapNotActive.selector);
        vault.executeDeposit(capId, address(usdc), 100e6, address(usdc), keccak256("ev"), "");
    }

    function test_GetRemainingAllowance() public view {
        (uint256 intervalRemaining, uint256 totalRemaining) = vault.getRemainingAllowance(capId);
        assertEq(intervalRemaining, 1000e6);
        assertEq(totalRemaining, 5000e6);
    }

    function test_ExecuteDepositRevertWrongAgent() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVault.InvalidSessionCap.selector);
        vault.executeDeposit(capId, address(usdc), 100e6, address(usdc), keccak256("ev"), "");
    }

    function test_DepositRevertWalletNotFound() public {
        vm.prank(owner);
        usdc.mint(owner, 100e6);
        usdc.approve(address(vault), 100e6);
        vm.expectRevert(SafeFlowVault.WalletNotFound.selector);
        vault.deposit(999, address(usdc), 100e6);
    }

    function test_DepositRevertZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVault.ZeroAmount.selector);
        vault.deposit(walletId, address(usdc), 0);
    }

    function test_DepositRevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVault.ZeroAddress.selector);
        vault.deposit(walletId, address(0), 100e6);
    }

    function test_WithdrawRevertInsufficientBalance() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVault.InsufficientBalance.selector);
        vault.withdraw(walletId, address(usdc), 99_999e6);
    }

    function test_WithdrawRevertZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVault.ZeroAmount.selector);
        vault.withdraw(walletId, address(usdc), 0);
    }

    function test_CreateSessionCapRevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVault.ZeroAddress.selector);
        vault.createSessionCap(walletId, address(0), 1000e6, 5000e6, 3600, uint64(block.timestamp + 1 days), "Cap");
    }

    function test_CreateSessionCapRevertNotOwner() public {
        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.NotOwner.selector);
        vault.createSessionCap(walletId, agent, 1000e6, 5000e6, 3600, uint64(block.timestamp + 1 days), "Cap");
    }

    function test_RevokeSessionCapRevertNotOwner() public {
        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.NotOwner.selector);
        vault.revokeSessionCap(capId);
    }

    function test_ExecuteDepositRevertZeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.ZeroAmount.selector);
        vault.executeDeposit(capId, address(usdc), 0, address(usdc), keccak256("ev"), "");
    }

    function test_ExecuteDepositRevertInsufficientBalance() public {
        // Create a new wallet with no balance
        vm.startPrank(owner);
        uint256 emptyWallet = vault.createWallet("Empty Wallet");
        uint256 emptyCap = vault.createSessionCap(emptyWallet, agent, 1000e6, 5000e6, 3600, uint64(block.timestamp + 1 days), "Empty Session");
        vm.stopPrank();

        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.InsufficientBalance.selector);
        vault.executeDeposit(emptyCap, address(usdc), 100e6, address(usdc), keccak256("ev"), "");
    }

    function test_IntervalResetsAfterWindow() public {
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 800e6);

        vm.startPrank(agent);
        // First spend 800 in interval
        vault.executeDeposit(capId, address(usdc), 800e6, address(usdc), keccak256("ev1"), callData);

        // Can't spend 800 more in same interval (would be 1600 > 1000)
        vm.expectRevert(SafeFlowVault.ExceedsIntervalLimit.selector);
        vault.executeDeposit(capId, address(usdc), 800e6, address(usdc), keccak256("ev2"), callData);

        // Warp past interval — should be able to spend again
        vm.warp(block.timestamp + 3601);
        vault.executeDeposit(capId, address(usdc), 800e6, address(usdc), keccak256("ev3"), callData);

        SafeFlowVault.SessionCap memory cap = vault.getSessionCap(capId);
        assertEq(cap.totalSpent, 1600e6);
        vm.stopPrank();
    }

    function test_AnyoneCanDeposit() public {
        address alice = makeAddr("alice");
        usdc.mint(alice, 500e6);

        vm.startPrank(alice);
        usdc.approve(address(vault), 500e6);
        vault.deposit(walletId, address(usdc), 500e6);
        vm.stopPrank();

        assertEq(vault.getBalance(walletId, address(usdc)), 10_500e6);
    }

    function test_GetRemainingAllowanceExpired() public {
        vm.warp(block.timestamp + 2 days);
        (uint256 intervalRem, uint256 totalRem) = vault.getRemainingAllowance(capId);
        assertEq(intervalRem, 0);
        assertEq(totalRem, 0);
    }

    function test_GetRemainingAllowanceRevoked() public {
        vm.prank(owner);
        vault.revokeSessionCap(capId);
        (uint256 intervalRem, uint256 totalRem) = vault.getRemainingAllowance(capId);
        assertEq(intervalRem, 0);
        assertEq(totalRem, 0);
    }

    // ─── Paginated Query Tests ────────────────────────────────

    function test_GetWalletsByOwner() public {
        vm.startPrank(owner);
        vault.createWallet("Wallet B");
        vault.createWallet("Wallet C");
        vm.stopPrank();

        assertEq(vault.getWalletCountByOwner(owner), 3);

        (uint256[] memory ids, SafeFlowVault.Wallet[] memory data) = vault.getWalletsByOwner(owner, 0, 10);
        assertEq(ids.length, 3);
        assertEq(data[0].name, "Test Wallet");
        assertEq(data[1].name, "Wallet B");
        assertEq(data[2].name, "Wallet C");

        // Pagination
        (uint256[] memory page1,) = vault.getWalletsByOwner(owner, 0, 2);
        assertEq(page1.length, 2);
        (uint256[] memory page2,) = vault.getWalletsByOwner(owner, 2, 2);
        assertEq(page2.length, 1);

        // Offset out of range
        (uint256[] memory empty,) = vault.getWalletsByOwner(owner, 10, 5);
        assertEq(empty.length, 0);
    }

    function test_GetCapsByAgent() public {
        vm.startPrank(owner);
        vault.createSessionCap(walletId, agent, 500e6, 2000e6, 1800, uint64(block.timestamp + 2 days), "Cap B");
        vault.createSessionCap(walletId, agent, 200e6, 1000e6, 900, uint64(block.timestamp + 3 days), "Cap C");
        vm.stopPrank();

        assertEq(vault.getCapCountByAgent(agent), 3);

        (uint256[] memory ids, SafeFlowVault.SessionCap[] memory data) = vault.getCapsByAgent(agent, 0, 10);
        assertEq(ids.length, 3);
        assertEq(data[0].name, "Test Session");
        assertEq(data[1].name, "Cap B");
        assertEq(data[2].name, "Cap C");
    }

    // ─── executeCall Tests ────────────────────────────────────

    function test_ExecuteCallDeposit() public {
        // amountIn > 0: behaves like executeDeposit — spending cap is enforced
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 400e6);

        vm.prank(agent);
        vault.executeCall(capId, address(usdc), callData, address(usdc), 400e6, address(0), keccak256("call-deposit"));

        SafeFlowVault.SessionCap memory cap = vault.getSessionCap(capId);
        assertEq(cap.totalSpent, 400e6);
        assertEq(vault.getBalance(walletId, address(usdc)), 9600e6);
        assertEq(usdc.balanceOf(recipient), 400e6);
    }

    function test_ExecuteCallWithdraw() public {
        // amountIn=0, tokenOut=USDC: no spending cap, inflows auto-credited
        // Call mints 300 USDC directly into the vault (simulates a DeFi vault returning yield)
        bytes memory callData = abi.encodeWithSignature("mint(address,uint256)", address(vault), 300e6);

        vm.prank(agent);
        vault.executeCall(capId, address(usdc), callData, address(0), 0, address(usdc), keccak256("call-withdraw"));

        // Balance should grow — recipient transferred 300 to vault, credited to walletId
        assertEq(vault.getBalance(walletId, address(usdc)), 10_300e6);

        // No spending cap consumed
        SafeFlowVault.SessionCap memory cap = vault.getSessionCap(capId);
        assertEq(cap.totalSpent, 0);
    }

    function test_ExecuteCallClaim() public {
        // amountIn=0, tokenOut=address(0): pure call, no cap check, no inflow tracking
        bytes memory callData = abi.encodeWithSignature("approve(address,uint256)", agent, 0);

        vm.prank(agent);
        vault.executeCall(capId, address(usdc), callData, address(0), 0, address(0), keccak256("call-claim"));

        // No spending cap consumed
        SafeFlowVault.SessionCap memory cap = vault.getSessionCap(capId);
        assertEq(cap.totalSpent, 0);
    }

    function test_ExecuteCallRevertExpired() public {
        vm.warp(block.timestamp + 2 days);
        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.SessionExpired.selector);
        vault.executeCall(capId, address(usdc), "", address(0), 0, address(0), keccak256("ev"));
    }

    function test_ExecuteCallRevertRevoked() public {
        vm.prank(owner);
        vault.revokeSessionCap(capId);
        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.SessionCapNotActive.selector);
        vault.executeCall(capId, address(usdc), "", address(0), 0, address(0), keccak256("ev"));
    }

    function test_ExecuteCallRevertWrongAgent() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVault.InvalidSessionCap.selector);
        vault.executeCall(capId, address(usdc), "", address(0), 0, address(0), keccak256("ev"));
    }

    function test_ExecuteCallRevertExceedsTotalLimit() public {
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 1000e6);
        vm.startPrank(agent);
        for (uint256 i; i < 5; i++) {
            vm.warp(block.timestamp + 3601);
            vault.executeCall(
                capId, address(usdc), callData, address(usdc), 1000e6, address(0), keccak256(abi.encode(i))
            );
        }
        vm.warp(block.timestamp + 3601);
        vm.expectRevert(SafeFlowVault.ExceedsTotalLimit.selector);
        vault.executeCall(capId, address(usdc), callData, address(usdc), 1000e6, address(0), keccak256("overflow"));
        vm.stopPrank();
    }

    function test_ExecuteCallRevertExceedsIntervalLimit() public {
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 600e6);
        vm.startPrank(agent);
        vault.executeCall(capId, address(usdc), callData, address(usdc), 600e6, address(0), keccak256("ev1"));
        vm.expectRevert(SafeFlowVault.ExceedsIntervalLimit.selector);
        vault.executeCall(capId, address(usdc), callData, address(usdc), 600e6, address(0), keccak256("ev2"));
        vm.stopPrank();
    }
}
