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
 *         - Agent calls executeDeposit() for backwards-compatible LI.FI Composer deposit flows.
 *         - Agent calls executeCall() for any arbitrary on-chain operation (withdraw, claim, rebalance).
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
    error CallFailed();
    error ZeroAmount();
    error ZeroAddress();
    error WalletNotFound();
    error Reentrancy();

    // ─── Structs ─────────────────────────────────────────────

    struct Wallet {
        address owner;
        bool exists;
        string name;
    }

    struct SessionCap {
        uint256 walletId;
        address agent;
        uint64 maxSpendPerInterval; // max token units agent can spend per interval
        uint256 maxSpendTotal;      // lifetime spending cap
        uint64 intervalSeconds;     // length of one rate-limit window
        uint64 expiresAt;           // unix timestamp
        uint256 totalSpent;         // cumulative spend
        uint64 lastSpendTime;       // timestamp of last spend action
        uint256 currentIntervalSpent; // spend in current interval
        bool active;
        string name;
    }

    // ─── State ───────────────────────────────────────────────

    uint256 public nextWalletId;
    uint256 public nextCapId;
    bool private _locked;

    mapping(uint256 => Wallet) public wallets;
    // walletId => token => balance
    mapping(uint256 => mapping(address => uint256)) public balances;
    mapping(uint256 => SessionCap) public sessionCaps;
    // Reverse indexes for on-chain paginated queries
    mapping(address => uint256[]) private _ownerWalletIds;
    mapping(address => uint256[]) private _agentCapIds;

    // ─── Modifiers ───────────────────────────────────────────

    modifier onlyWalletOwner(uint256 walletId) {
        _checkWalletOwner(walletId);
        _;
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    function _checkWalletOwner(uint256 walletId) internal view {
        if (wallets[walletId].owner != msg.sender) revert NotOwner();
    }

    // ─── Wallet Management ───────────────────────────────────

    function createWallet(string calldata name) external returns (uint256 walletId) {
        walletId = nextWalletId++;
        wallets[walletId] = Wallet({owner: msg.sender, exists: true, name: name});
        _ownerWalletIds[msg.sender].push(walletId);
        emit WalletCreated(msg.sender, walletId, name);
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
        uint64 expiresAt,
        string calldata name
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
            active: true,
            name: name
        });
        _agentCapIds[agent].push(capId);

        emit SessionCapCreated(walletId, capId, agent, maxSpendPerInterval, maxSpendTotal, intervalSeconds, expiresAt, name);
    }

    function revokeSessionCap(uint256 capId) external {
        SessionCap storage cap = sessionCaps[capId];
        if (wallets[cap.walletId].owner != msg.sender) revert NotOwner();
        cap.active = false;
        emit SessionCapRevoked(capId);
    }

    // ─── Internal: Validate and Debit Spending Cap ───────────

    /**
     * @dev Shared validation and state mutation for outbound spending operations.
     *      Checks total cap, interval rate limit, and wallet balance. Updates all counters.
     */
    function _validateAndDebitSpend(
        SessionCap storage cap,
        uint256 walletId,
        address token,
        uint256 amount
    ) internal {
        // Check total limit
        if (cap.totalSpent + amount > cap.maxSpendTotal) revert ExceedsTotalLimit();

        // Check interval rate limit
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime - cap.lastSpendTime >= cap.intervalSeconds) {
            // New interval — reset
            cap.currentIntervalSpent = 0;
        }
        if (cap.currentIntervalSpent + amount > cap.maxSpendPerInterval) revert ExceedsIntervalLimit();

        // Check wallet balance
        if (balances[walletId][token] < amount) revert InsufficientBalance();

        // Update state
        cap.totalSpent += amount;
        cap.currentIntervalSpent += amount;
        cap.lastSpendTime = currentTime;
        balances[walletId][token] -= amount;
    }

    // ─── Agent Execution ─────────────────────────────────────

    /**
     * @notice Agent executes a deposit into a yield vault using its SessionCap.
     *         Backwards-compatible entry point retained for LI.FI Composer deposit flows.
     * @param capId        The SessionCap authorizing this spend
     * @param token        ERC-20 token to deposit
     * @param amount       Amount of tokens to deposit
     * @param vault        Target vault/contract address
     * @param evidenceHash keccak256 of the agent's reasoning payload (stored in DB/IPFS)
     * @param callData     Encoded call to execute on the vault (from LI.FI Composer quote)
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

        if (!cap.active) revert SessionCapNotActive();
        if (cap.agent != msg.sender) revert InvalidSessionCap();
        if (block.timestamp > cap.expiresAt) revert SessionExpired();
        if (amount == 0) revert ZeroAmount();

        uint256 walletId = cap.walletId;
        _validateAndDebitSpend(cap, walletId, token, amount);

        IERC20(token).approve(vault, amount);
        (bool success,) = vault.call(callData);
        if (!success) revert TransferFailed();

        emit DepositExecuted(walletId, capId, vault, token, amount, evidenceHash);
    }

    /**
     * @notice General-purpose agent execution primitive. Supports any on-chain operation:
     *         deposit into vaults, withdraw from vaults, claim rewards, rebalance positions.
     *
     * @param capId        SessionCap authorizing this action
     * @param target       Contract to call
     * @param callData     Encoded calldata to forward to target
     * @param tokenIn      ERC-20 leaving the wallet (approve → target). address(0) = no outbound spend.
     * @param amountIn     Amount of tokenIn to approve and debit. 0 = no spending-cap check applied.
     * @param tokenOut     ERC-20 expected to flow back into the wallet after the call.
     *                     address(0) = no inbound tracking.
     * @param evidenceHash keccak256 of the agent's reasoning payload
     *
     * Examples:
     *   Deposit:   tokenIn=USDC, amountIn=1000e6, tokenOut=address(0)
     *   Withdraw:  tokenIn=address(0), amountIn=0,     tokenOut=USDC  (balance auto-credited)
     *   Claim:     tokenIn=address(0), amountIn=0,     tokenOut=address(0)
     */
    function executeCall(
        uint256 capId,
        address target,
        bytes calldata callData,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        bytes32 evidenceHash
    ) external nonReentrant {
        SessionCap storage cap = sessionCaps[capId];

        // Auth checks always required
        if (!cap.active) revert SessionCapNotActive();
        if (cap.agent != msg.sender) revert InvalidSessionCap();
        if (block.timestamp > cap.expiresAt) revert SessionExpired();

        uint256 walletId = cap.walletId;

        // Spending cap enforcement only when amountIn > 0
        if (amountIn > 0) {
            _validateAndDebitSpend(cap, walletId, tokenIn, amountIn);
            IERC20(tokenIn).approve(target, amountIn);
        }

        // Snapshot pre-call balance of tokenOut for inflow delta tracking
        uint256 balanceBefore;
        if (tokenOut != address(0)) {
            balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        }

        // Execute
        (bool success,) = target.call(callData);
        if (!success) revert CallFailed();

        // Credit any inflows back to the wallet balance
        uint256 amountOut;
        if (tokenOut != address(0)) {
            uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
            if (balanceAfter > balanceBefore) {
                amountOut = balanceAfter - balanceBefore;
                balances[walletId][tokenOut] += amountOut;
            }
        }

        emit ActionExecuted(walletId, capId, target, tokenIn, amountIn, tokenOut, amountOut, evidenceHash);
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

    // ─── Paginated On-Chain Queries ──────────────────────────

    function getWalletCountByOwner(address owner) external view returns (uint256) {
        return _ownerWalletIds[owner].length;
    }

    function getCapCountByAgent(address agent) external view returns (uint256) {
        return _agentCapIds[agent].length;
    }

    function getWalletsByOwner(address owner, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory walletIds, Wallet[] memory walletData)
    {
        uint256[] storage ids = _ownerWalletIds[owner];
        uint256 total = ids.length;
        if (offset >= total) return (new uint256[](0), new Wallet[](0));
        uint256 count = total - offset;
        if (count > limit) count = limit;

        walletIds = new uint256[](count);
        walletData = new Wallet[](count);
        for (uint256 i; i < count; i++) {
            uint256 id = ids[offset + i];
            walletIds[i] = id;
            walletData[i] = wallets[id];
        }
    }

    function getCapsByAgent(address agent, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory capIds, SessionCap[] memory capData)
    {
        uint256[] storage ids = _agentCapIds[agent];
        uint256 total = ids.length;
        if (offset >= total) return (new uint256[](0), new SessionCap[](0));
        uint256 count = total - offset;
        if (count > limit) count = limit;

        capIds = new uint256[](count);
        capData = new SessionCap[](count);
        for (uint256 i; i < count; i++) {
            uint256 id = ids[offset + i];
            capIds[i] = id;
            capData[i] = sessionCaps[id];
        }
    }
}
