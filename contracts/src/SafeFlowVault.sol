// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {ISafeFlowEvents} from "./interfaces/ISafeFlow.sol";

/**
 * @title SafeFlowVault
 * @notice On-chain agent wallet with session-based spending caps for DeFi yield management.
 *         Translates SafeFlow's Sui Move SessionCap model to EVM.
 *
 *         - Owner deposits ERC-20 tokens into a wallet.
 *         - Owner grants SessionCaps to agent addresses with rate limits and expiry.
 *         - Agent calls executeDeposit() to deposit into LI.FI Earn vaults, bounded by caps.
 */
contract SafeFlowVault is ISafeFlowEvents {
    // ─── Errors ──────────────────────────────────────────────
    error NotOwner();
    error SessionExpired();
    error ExceedsIntervalLimit();
    error ExceedsTotalLimit();
    error InsufficientBalance();
    error InvalidSessionCap();
    error SessionCapNotActive();
    error TransferFailed();
    error ZeroAmount();
    error ZeroAddress();
    error WalletNotFound();

    // ─── Structs ─────────────────────────────────────────────

    struct Wallet {
        address owner;
        bool exists;
    }

    struct SessionCap {
        uint256 walletId;
        address agent;
        uint64 maxSpendPerInterval; // max token units agent can spend per interval
        uint256 maxSpendTotal;      // lifetime spending cap
        uint64 intervalSeconds;     // length of one rate-limit window
        uint64 expiresAt;           // unix timestamp
        uint256 totalSpent;         // cumulative spend
        uint64 lastSpendTime;       // timestamp of last executeDeposit
        uint256 currentIntervalSpent; // spend in current interval
        bool active;
    }

    // ─── State ───────────────────────────────────────────────

    uint256 public nextWalletId;
    uint256 public nextCapId;

    mapping(uint256 => Wallet) public wallets;
    // walletId => token => balance
    mapping(uint256 => mapping(address => uint256)) public balances;
    mapping(uint256 => SessionCap) public sessionCaps;

    // ─── Modifiers ───────────────────────────────────────────

    modifier onlyWalletOwner(uint256 walletId) {
        _checkWalletOwner(walletId);
        _;
    }

    function _checkWalletOwner(uint256 walletId) internal view {
        if (wallets[walletId].owner != msg.sender) revert NotOwner();
    }

    // ─── Wallet Management ───────────────────────────────────

    function createWallet() external returns (uint256 walletId) {
        walletId = nextWalletId++;
        wallets[walletId] = Wallet({owner: msg.sender, exists: true});
        emit WalletCreated(msg.sender, walletId);
    }

    function deposit(uint256 walletId, address token, uint256 amount) external {
        if (!wallets[walletId].exists) revert WalletNotFound();
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        balances[walletId][token] += amount;
        emit Deposited(walletId, token, amount);
    }

    function withdraw(uint256 walletId, address token, uint256 amount) external onlyWalletOwner(walletId) {
        if (amount == 0) revert ZeroAmount();
        if (balances[walletId][token] < amount) revert InsufficientBalance();

        balances[walletId][token] -= amount;
        if (!IERC20(token).transfer(msg.sender, amount)) revert TransferFailed();
        emit Withdrawn(walletId, token, amount);
    }

    // ─── SessionCap Management ───────────────────────────────

    function createSessionCap(
        uint256 walletId,
        address agent,
        uint64 maxSpendPerInterval,
        uint256 maxSpendTotal,
        uint64 intervalSeconds,
        uint64 expiresAt
    ) external onlyWalletOwner(walletId) returns (uint256 capId) {
        if (agent == address(0)) revert ZeroAddress();

        capId = nextCapId++;
        sessionCaps[capId] = SessionCap({
            walletId: walletId,
            agent: agent,
            maxSpendPerInterval: maxSpendPerInterval,
            maxSpendTotal: maxSpendTotal,
            intervalSeconds: intervalSeconds,
            expiresAt: expiresAt,
            totalSpent: 0,
            lastSpendTime: 0,
            currentIntervalSpent: 0,
            active: true
        });

        emit SessionCapCreated(walletId, capId, agent, maxSpendPerInterval, maxSpendTotal, intervalSeconds, expiresAt);
    }

    function revokeSessionCap(uint256 capId) external {
        SessionCap storage cap = sessionCaps[capId];
        if (wallets[cap.walletId].owner != msg.sender) revert NotOwner();
        cap.active = false;
        emit SessionCapRevoked(capId);
    }

    // ─── Agent Execution ─────────────────────────────────────

    /**
     * @notice Agent executes a deposit into a yield vault using its SessionCap.
     *         The vault receives tokens via ERC-20 transfer. The agent is responsible
     *         for building the correct calldata (via LI.FI Composer) off-chain.
     * @param capId       The SessionCap authorizing this spend
     * @param token       ERC-20 token to deposit
     * @param amount      Amount of tokens to deposit
     * @param vault       Target vault/contract address (LI.FI toToken)
     * @param evidenceHash keccak256 of the agent's reasoning payload (stored in DB/IPFS)
     * @param callData    Encoded call to execute on the vault (from LI.FI Composer quote)
     */
    function executeDeposit(
        uint256 capId,
        address token,
        uint256 amount,
        address vault,
        bytes32 evidenceHash,
        bytes calldata callData
    ) external {
        SessionCap storage cap = sessionCaps[capId];

        // 1. Validate session cap
        if (!cap.active) revert SessionCapNotActive();
        if (cap.agent != msg.sender) revert InvalidSessionCap();
        if (block.timestamp > cap.expiresAt) revert SessionExpired();
        if (amount == 0) revert ZeroAmount();

        // 2. Check total limit
        if (cap.totalSpent + amount > cap.maxSpendTotal) revert ExceedsTotalLimit();

        // 3. Check interval rate limit
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime - cap.lastSpendTime >= cap.intervalSeconds) {
            // New interval — reset
            cap.currentIntervalSpent = 0;
        }
        if (cap.currentIntervalSpent + amount > cap.maxSpendPerInterval) revert ExceedsIntervalLimit();

        // 4. Check wallet balance
        uint256 walletId = cap.walletId;
        if (balances[walletId][token] < amount) revert InsufficientBalance();

        // 5. Update state
        cap.totalSpent += amount;
        cap.currentIntervalSpent += amount;
        cap.lastSpendTime = currentTime;
        balances[walletId][token] -= amount;

        // 6. Approve and execute the vault deposit via LI.FI Composer calldata
        IERC20(token).approve(vault, amount);
        (bool success,) = vault.call(callData);
        if (!success) revert TransferFailed();

        emit DepositExecuted(walletId, capId, vault, token, amount, evidenceHash);
    }

    // ─── View Functions ──────────────────────────────────────

    function getBalance(uint256 walletId, address token) external view returns (uint256) {
        return balances[walletId][token];
    }

    function getSessionCap(uint256 capId) external view returns (SessionCap memory) {
        return sessionCaps[capId];
    }

    function getWallet(uint256 walletId) external view returns (Wallet memory) {
        return wallets[walletId];
    }

    function getRemainingAllowance(uint256 capId) external view returns (uint256 intervalRemaining, uint256 totalRemaining) {
        SessionCap storage cap = sessionCaps[capId];
        if (!cap.active || block.timestamp > cap.expiresAt) {
            return (0, 0);
        }

        totalRemaining = cap.maxSpendTotal > cap.totalSpent ? cap.maxSpendTotal - cap.totalSpent : 0;

        uint64 currentTime = uint64(block.timestamp);
        if (currentTime - cap.lastSpendTime >= cap.intervalSeconds) {
            intervalRemaining = cap.maxSpendPerInterval;
        } else {
            intervalRemaining = cap.maxSpendPerInterval > cap.currentIntervalSpent
                ? cap.maxSpendPerInterval - cap.currentIntervalSpent
                : 0;
        }
    }
}
