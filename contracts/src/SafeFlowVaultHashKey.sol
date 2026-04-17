// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SafeFlowVaultHashKey
 * @notice Agent Air-Gap Wallet for HashKey Chain.
 *         Humans deposit funds and grant rate-limited SessionCaps to AI agents.
 *         Agents execute payments constrained by on-chain rate/total/expiry rules.
 */
contract SafeFlowVaultHashKey {
    // ======================== Errors ========================

    error NotVaultOwner();
    error VaultNotFound();
    error SessionNotFound();
    error SessionExpired();
    error SessionAlreadyExists();
    error ExceedsRateLimit();
    error ExceedsTotalLimit();
    error InsufficientBalance();
    error ZeroAmount();
    error InvalidAddress();
    error TransferFailed();

    // ======================== Structs ========================

    struct Vault {
        address owner;
        uint256 balance;
        bool exists;
    }

    struct SessionCap {
        uint256 vaultId;
        uint256 maxSpendPerSecond; // wei per second
        uint256 maxSpendTotal;     // wei lifetime cap
        uint256 totalSpent;
        uint256 lastSpendTimeSec;  // last payment timestamp (seconds)
        uint256 expiresAtSec;      // expiration timestamp (seconds)
        bool exists;
    }

    // ======================== Events ========================

    event VaultCreated(
        uint256 indexed vaultId,
        address indexed owner
    );

    event Deposited(
        uint256 indexed vaultId,
        address indexed depositor,
        uint256 amount
    );

    event SessionGranted(
        uint256 indexed vaultId,
        address indexed agent,
        uint256 maxSpendPerSecond,
        uint256 maxSpendTotal,
        uint256 expiresAtSec
    );

    event SessionRevoked(
        uint256 indexed vaultId,
        address indexed agent
    );

    event PaymentExecuted(
        uint256 indexed vaultId,
        address indexed agent,
        address indexed recipient,
        uint256 amount,
        bytes32 reasonHash,
        string reasonMemo
    );

    event Withdrawn(
        uint256 indexed vaultId,
        address indexed owner,
        uint256 amount
    );

    // ======================== State ========================

    uint256 public nextVaultId;

    /// vaultId => Vault
    mapping(uint256 => Vault) public vaults;

    /// vaultId => agent address => SessionCap
    mapping(uint256 => mapping(address => SessionCap)) public sessions;

    /// owner address => list of vault IDs they own
    mapping(address => uint256[]) public ownerVaults;

    // ======================== Modifiers ========================

    modifier onlyVaultOwner(uint256 vaultId) {
        if (!vaults[vaultId].exists) revert VaultNotFound();
        if (vaults[vaultId].owner != msg.sender) revert NotVaultOwner();
        _;
    }

    // ======================== Vault Management ========================

    /**
     * @notice Create a new vault. The caller becomes the owner.
     * @return vaultId The ID of the newly created vault.
     */
    function createVault() external returns (uint256 vaultId) {
        vaultId = nextVaultId++;
        vaults[vaultId] = Vault({owner: msg.sender, balance: 0, exists: true});
        ownerVaults[msg.sender].push(vaultId);
        emit VaultCreated(vaultId, msg.sender);
    }

    /**
     * @notice Deposit native token (HSK) into the vault.
     * @param vaultId The vault to deposit into.
     */
    function deposit(uint256 vaultId) external payable {
        if (!vaults[vaultId].exists) revert VaultNotFound();
        if (msg.value == 0) revert ZeroAmount();
        vaults[vaultId].balance += msg.value;
        emit Deposited(vaultId, msg.sender, msg.value);
    }

    /**
     * @notice Vault owner withdraws funds back to their address.
     * @param vaultId The vault to withdraw from.
     * @param amount The amount to withdraw in wei.
     */
    function withdraw(uint256 vaultId, uint256 amount) external onlyVaultOwner(vaultId) {
        if (amount == 0) revert ZeroAmount();
        if (vaults[vaultId].balance < amount) revert InsufficientBalance();

        vaults[vaultId].balance -= amount;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(vaultId, msg.sender, amount);
    }

    // ======================== Session Management ========================

    /**
     * @notice Grant a rate-limited session to an AI agent.
     * @param vaultId         Vault the session is bound to.
     * @param agent           Agent address (EOA generated locally by agent).
     * @param maxSpendPerSec  Maximum spend per second in wei.
     * @param maxSpendTotal   Lifetime maximum spend in wei.
     * @param expiresAtSec    Unix timestamp (seconds) when session expires.
     */
    function grantSession(
        uint256 vaultId,
        address agent,
        uint256 maxSpendPerSec,
        uint256 maxSpendTotal,
        uint256 expiresAtSec
    ) external onlyVaultOwner(vaultId) {
        if (agent == address(0)) revert InvalidAddress();
        if (sessions[vaultId][agent].exists) revert SessionAlreadyExists();

        sessions[vaultId][agent] = SessionCap({
            vaultId: vaultId,
            maxSpendPerSecond: maxSpendPerSec,
            maxSpendTotal: maxSpendTotal,
            totalSpent: 0,
            lastSpendTimeSec: block.timestamp,
            expiresAtSec: expiresAtSec,
            exists: true
        });

        emit SessionGranted(vaultId, agent, maxSpendPerSec, maxSpendTotal, expiresAtSec);
    }

    /**
     * @notice Revoke an agent's session immediately.
     * @param vaultId The vault the session is bound to.
     * @param agent   The agent whose session to revoke.
     */
    function revokeSession(uint256 vaultId, address agent) external onlyVaultOwner(vaultId) {
        if (!sessions[vaultId][agent].exists) revert SessionNotFound();
        delete sessions[vaultId][agent];
        emit SessionRevoked(vaultId, agent);
    }

    // ======================== Payment Execution ========================

    /**
     * @notice Agent executes a payment from the vault, subject to rate-limit,
     *         total-limit and expiry checks.
     * @param vaultId     The vault to pay from.
     * @param recipient   Payment recipient.
     * @param amount      Amount in wei.
     * @param reasonHash  SHA-256 hash of the agent's reasoning payload (audit trail).
     * @param reasonMemo  Short human-readable memo (emitted in event, cheap on L2).
     */
    function executePayment(
        uint256 vaultId,
        address recipient,
        uint256 amount,
        bytes32 reasonHash,
        string calldata reasonMemo
    ) external {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        if (!vaults[vaultId].exists) revert VaultNotFound();

        SessionCap storage cap = sessions[vaultId][msg.sender];
        if (!cap.exists) revert SessionNotFound();

        // 1. Check expiration
        if (block.timestamp > cap.expiresAtSec) revert SessionExpired();

        // 2. Check total spend limit
        if (cap.totalSpent + amount > cap.maxSpendTotal) revert ExceedsTotalLimit();

        // 3. Check rate limit (spend per second)
        uint256 elapsed = block.timestamp - cap.lastSpendTimeSec;
        uint256 allowedSpend = elapsed * cap.maxSpendPerSecond;
        if (amount > allowedSpend) revert ExceedsRateLimit();

        // 4. Check vault balance
        if (vaults[vaultId].balance < amount) revert InsufficientBalance();

        // Update state
        cap.totalSpent += amount;
        cap.lastSpendTimeSec = block.timestamp;
        vaults[vaultId].balance -= amount;

        // Transfer funds
        (bool ok,) = payable(recipient).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit PaymentExecuted(vaultId, msg.sender, recipient, amount, reasonHash, reasonMemo);
    }

    // ======================== View Functions ========================

    /**
     * @notice Get vault info.
     */
    function getVault(uint256 vaultId) external view returns (address owner, uint256 balance, bool exists) {
        Vault storage v = vaults[vaultId];
        return (v.owner, v.balance, v.exists);
    }

    /**
     * @notice Get session info for an agent on a vault.
     */
    function getSession(uint256 vaultId, address agent)
        external
        view
        returns (
            uint256 maxSpendPerSecond,
            uint256 maxSpendTotal,
            uint256 totalSpent,
            uint256 lastSpendTimeSec,
            uint256 expiresAtSec,
            bool exists
        )
    {
        SessionCap storage s = sessions[vaultId][agent];
        return (s.maxSpendPerSecond, s.maxSpendTotal, s.totalSpent, s.lastSpendTimeSec, s.expiresAtSec, s.exists);
    }

    /**
     * @notice Get all vault IDs owned by an address.
     */
    function getOwnerVaults(address owner) external view returns (uint256[] memory) {
        return ownerVaults[owner];
    }

    /**
     * @notice Calculate how much an agent can currently spend given rate limit.
     */
    function getAvailableAllowance(uint256 vaultId, address agent) external view returns (uint256) {
        SessionCap storage s = sessions[vaultId][agent];
        if (!s.exists || block.timestamp > s.expiresAtSec) return 0;

        uint256 elapsed = block.timestamp - s.lastSpendTimeSec;
        uint256 rateAllowed = elapsed * s.maxSpendPerSecond;
        uint256 totalRemaining = s.maxSpendTotal - s.totalSpent;
        uint256 vaultBal = vaults[vaultId].balance;

        uint256 allowed = rateAllowed < totalRemaining ? rateAllowed : totalRemaining;
        return allowed < vaultBal ? allowed : vaultBal;
    }
}
