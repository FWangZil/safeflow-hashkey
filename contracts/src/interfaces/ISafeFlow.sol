// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISafeFlowEvents {
    event WalletCreated(address indexed owner, uint256 indexed walletId, string name);
    event Deposited(uint256 indexed walletId, address indexed token, uint256 amount);
    event Withdrawn(uint256 indexed walletId, address indexed token, uint256 amount);
    event SessionCapCreated(
        uint256 indexed walletId,
        uint256 indexed capId,
        address indexed agent,
        uint64 maxSpendPerInterval,
        uint256 maxSpendTotal,
        uint64 intervalSeconds,
        uint64 expiresAt,
        string name
    );
    event SessionCapRevoked(uint256 indexed capId);
    event DepositExecuted(
        uint256 indexed walletId,
        uint256 indexed capId,
        address indexed vault,
        address token,
        uint256 amount,
        bytes32 evidenceHash
    );
    /// @notice Emitted by executeCall() for any agent-initiated on-chain action.
    event ActionExecuted(
        uint256 indexed walletId,
        uint256 indexed capId,
        address indexed target,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut,
        bytes32 evidenceHash
    );
}
