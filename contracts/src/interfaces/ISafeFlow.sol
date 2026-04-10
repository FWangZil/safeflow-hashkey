// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISafeFlowEvents {
    event WalletCreated(address indexed owner, uint256 indexed walletId);
    event Deposited(uint256 indexed walletId, address indexed token, uint256 amount);
    event Withdrawn(uint256 indexed walletId, address indexed token, uint256 amount);
    event SessionCapCreated(
        uint256 indexed walletId,
        uint256 indexed capId,
        address indexed agent,
        uint64 maxSpendPerInterval,
        uint256 maxSpendTotal,
        uint64 intervalSeconds,
        uint64 expiresAt
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
}
