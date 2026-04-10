// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
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
        walletId = vault.createWallet();

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
            uint64(block.timestamp + 1 days) // expiresAt
        );
        vm.stopPrank();
    }

    function test_CreateWallet() public view {
        SafeFlowVault.Wallet memory w = vault.getWallet(walletId);
        assertEq(w.owner, owner);
        assertTrue(w.exists);
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
    }

    function test_ExecuteDeposit() public {
        // Use recipient as a mock "vault" that just receives tokens
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 500e6);

        vm.prank(agent);
        vault.executeDeposit(capId, address(usdc), 500e6, address(usdc), bytes32("evidence1"), callData);

        // Check cap state updated
        SafeFlowVault.SessionCap memory cap = vault.getSessionCap(capId);
        assertEq(cap.totalSpent, 500e6);
    }

    function test_ExecuteDepositRevertExpired() public {
        // Warp past expiry
        vm.warp(block.timestamp + 2 days);

        vm.prank(agent);
        vm.expectRevert(SafeFlowVault.SessionExpired.selector);
        vault.executeDeposit(capId, address(usdc), 100e6, address(usdc), bytes32("evidence"), "");
    }

    function test_ExecuteDepositRevertTotalLimit() public {
        // Try to exceed total limit in multiple calls
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 1000e6);

        vm.startPrank(agent);
        // First 5 calls of 1000 each should succeed with interval resets
        for (uint256 i = 0; i < 5; i++) {
            vm.warp(block.timestamp + 3601); // new interval
            vault.executeDeposit(capId, address(usdc), 1000e6, address(usdc), bytes32("evidence"), callData);
        }

        // 6th call should fail
        vm.warp(block.timestamp + 3601);
        vm.expectRevert(SafeFlowVault.ExceedsTotalLimit.selector);
        vault.executeDeposit(capId, address(usdc), 1000e6, address(usdc), bytes32("evidence"), callData);
        vm.stopPrank();
    }

    function test_ExecuteDepositRevertIntervalLimit() public {
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", recipient, 600e6);

        vm.startPrank(agent);
        // First call of 600 succeeds
        vault.executeDeposit(capId, address(usdc), 600e6, address(usdc), bytes32("ev1"), callData);

        // Second call of 600 in same interval should fail (1200 > 1000 limit)
        vm.expectRevert(SafeFlowVault.ExceedsIntervalLimit.selector);
        vault.executeDeposit(capId, address(usdc), 600e6, address(usdc), bytes32("ev2"), callData);
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
        vault.executeDeposit(capId, address(usdc), 100e6, address(usdc), bytes32("ev"), "");
    }

    function test_GetRemainingAllowance() public view {
        (uint256 intervalRemaining, uint256 totalRemaining) = vault.getRemainingAllowance(capId);
        assertEq(intervalRemaining, 1000e6);
        assertEq(totalRemaining, 5000e6);
    }

    function test_ExecuteDepositRevertWrongAgent() public {
        vm.prank(owner);
        vm.expectRevert(SafeFlowVault.InvalidSessionCap.selector);
        vault.executeDeposit(capId, address(usdc), 100e6, address(usdc), bytes32("ev"), "");
    }
}
