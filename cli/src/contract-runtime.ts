import chalk from 'chalk';
import { execFile, spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const execFileAsync = promisify(execFile);

const safeflowAbi = parseAbi([
  'function createWallet(string name) returns (uint256)',
  'function deposit(uint256 walletId, address token, uint256 amount)',
  'function createSessionCap(uint256 walletId, address agent, uint64 maxSpendPerInterval, uint256 maxSpendTotal, uint64 intervalSeconds, uint64 expiresAt, string name) returns (uint256)',
  'function revokeSessionCap(uint256 capId)',
  'function getSessionCap(uint256 capId) view returns ((uint256 walletId, address agent, uint64 maxSpendPerInterval, uint256 maxSpendTotal, uint64 intervalSeconds, uint64 expiresAt, uint256 totalSpent, uint64 lastSpendTime, uint256 currentIntervalSpent, bool active, string name))',
  'function getRemainingAllowance(uint256 capId) view returns (uint256 intervalRemaining, uint256 totalRemaining)',
  'function executeDeposit(uint256 capId, address token, uint256 amount, address vault, bytes32 evidenceHash, bytes callData)',
  'function executeCall(uint256 capId, address target, bytes callData, address tokenIn, uint256 amountIn, address tokenOut, bytes32 evidenceHash)',
]);

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export type BackendMode = 'auto' | 'cast' | 'viem';
export type ResolvedBackend = 'cast' | 'viem';

export interface SessionCapInfo {
  walletId: bigint;
  agent: Address;
  maxSpendPerInterval: bigint;
  maxSpendTotal: bigint;
  intervalSeconds: bigint;
  expiresAt: bigint;
  totalSpent: bigint;
  lastSpendTime: bigint;
  currentIntervalSpent: bigint;
  active: boolean;
}

export interface RemainingAllowance {
  intervalRemaining: bigint;
  totalRemaining: bigint;
}

export interface ContractRuntimeOptions {
  backend: BackendMode;
  rpcUrl: string;
  chainId: number;
  promptForFoundry?: boolean;
}

export interface ContractRuntime {
  backend: ResolvedBackend;
  createWallet: (contractAddress: Address, name?: string) => Promise<string>;
  approveToken: (token: Address, spender: Address, amount: bigint) => Promise<string>;
  depositToWallet: (contractAddress: Address, walletId: bigint, token: Address, amount: bigint) => Promise<string>;
  createSessionCap: (
    contractAddress: Address,
    walletId: bigint,
    agent: Address,
    maxPerInterval: bigint,
    maxTotal: bigint,
    intervalSeconds: bigint,
    expiresAt: bigint,
    name?: string,
  ) => Promise<string>;
  revokeSessionCap: (contractAddress: Address, capId: bigint) => Promise<string>;
  getSessionCap: (contractAddress: Address, capId: bigint) => Promise<SessionCapInfo>;
  getRemainingAllowance: (contractAddress: Address, capId: bigint) => Promise<RemainingAllowance>;
  executeDeposit: (
    contractAddress: Address,
    capId: bigint,
    token: Address,
    amount: bigint,
    vault: Address,
    evidenceHash: Hex,
    callData: Hex,
  ) => Promise<string>;
}

function normalizePrivateKey(value: string): Hex {
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex;
}

function getOptionalPrivateKey(): Hex | null {
  const value = process.env.PRIVATE_KEY;
  if (!value) return null;
  return normalizePrivateKey(value);
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCastBinary(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', ['cast']);
    const candidate = stdout.trim();
    if (candidate) return candidate;
  } catch {
  }

  const localCast = join(homedir(), '.foundry', 'bin', 'cast');
  if (await canExecute(localCast)) {
    return localCast;
  }

  return null;
}

async function askToInstallFoundry(): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(chalk.yellow('`cast` command not found. Install Foundry now? [Y/n] '))).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function runInteractive(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function installFoundry(): Promise<string> {
  console.log(chalk.bold('\n⬇️ Installing Foundry...\n'));
  await runInteractive('bash', ['-lc', 'curl -L https://foundry.paradigm.xyz | bash']);

  const foundryupPath = join(homedir(), '.foundry', 'bin', 'foundryup');
  if (!(await canExecute(foundryupPath))) {
    throw new Error(`Foundry installer completed but ${foundryupPath} is not executable.`);
  }

  await runInteractive(foundryupPath, []);

  const castPath = join(homedir(), '.foundry', 'bin', 'cast');
  if (!(await canExecute(castPath))) {
    throw new Error('Foundry installation finished, but cast is still unavailable.');
  }

  return castPath;
}

function getViemClients(rpcUrl: string) {
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const privateKey = getOptionalPrivateKey();
  const account = privateKey ? privateKeyToAccount(privateKey) : null;
  const walletClient = account
    ? createWalletClient({
        account,
        transport: http(rpcUrl),
      })
    : null;

  return { publicClient, walletClient, account };
}

function requireWalletClient<T>(walletClient: T | null, backend: ResolvedBackend): T {
  if (!walletClient) {
    throw new Error(`PRIVATE_KEY is required for ${backend} write operations.`);
  }
  return walletClient;
}

function extractCastTxHash(output: string): string {
  const txHashMatch = output.match(/transactionHash\s+([0-9a-fx]+)/i);
  return txHashMatch?.[1] || output.trim();
}

function createCastRuntime(castBinary: string, rpcUrl: string): ContractRuntime {
  const { publicClient } = getViemClients(rpcUrl);

  const castSend = async (target: Address, signature: string, args: Array<string | bigint>): Promise<string> => {
    const privateKey = getOptionalPrivateKey();
    if (!privateKey) {
      throw new Error('PRIVATE_KEY is required for cast write operations.');
    }

    const { stdout, stderr } = await execFileAsync(castBinary, [
      'send',
      target,
      signature,
      ...args.map(value => value.toString()),
      '--rpc-url',
      rpcUrl,
      '--private-key',
      privateKey,
    ]);

    return extractCastTxHash(stdout.trim() || stderr.trim());
  };

  return {
    backend: 'cast',
    createWallet: (contractAddress, name = '') => castSend(contractAddress, 'createWallet(string)', [name]),
    approveToken: (token, spender, amount) => castSend(token, 'approve(address,uint256)', [spender, amount]),
    depositToWallet: (contractAddress, walletId, token, amount) => castSend(contractAddress, 'deposit(uint256,address,uint256)', [walletId, token, amount]),
    createSessionCap: (contractAddress, walletId, agent, maxPerInterval, maxTotal, intervalSeconds, expiresAt, name = '') =>
      castSend(contractAddress, 'createSessionCap(uint256,address,uint64,uint256,uint64,uint64,string)', [walletId, agent, maxPerInterval, maxTotal, intervalSeconds, expiresAt, name]),
    revokeSessionCap: (contractAddress, capId) => castSend(contractAddress, 'revokeSessionCap(uint256)', [capId]),
    getSessionCap: async (contractAddress, capId) => {
      const cap = await publicClient.readContract({
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'getSessionCap',
        args: [capId],
      });
      return cap as SessionCapInfo;
    },
    getRemainingAllowance: async (contractAddress, capId) => {
      const [intervalRemaining, totalRemaining] = await publicClient.readContract({
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'getRemainingAllowance',
        args: [capId],
      });
      return { intervalRemaining, totalRemaining };
    },
    executeDeposit: (contractAddress, capId, token, amount, vault, evidenceHash, callData) =>
      castSend(contractAddress, 'executeDeposit(uint256,address,uint256,address,bytes32,bytes)', [capId, token, amount, vault, evidenceHash, callData]),
  };
}

function createViemRuntime(rpcUrl: string): ContractRuntime {
  const { publicClient, walletClient, account } = getViemClients(rpcUrl);
  const activeWalletClient = requireWalletClient(walletClient, 'viem');

  const waitForWrite = async (hash: Hex): Promise<string> => {
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  return {
    backend: 'viem',
    createWallet: async (contractAddress, name = '') => {
      const hash = await activeWalletClient.writeContract({
        chain: null,
        account: account ?? undefined,
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'createWallet',
        args: [name],
      });
      return waitForWrite(hash);
    },
    approveToken: async (token, spender, amount) => {
      const hash = await activeWalletClient.writeContract({
        chain: null,
        account: account ?? undefined,
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
      });
      return waitForWrite(hash);
    },
    depositToWallet: async (contractAddress, walletId, token, amount) => {
      const hash = await activeWalletClient.writeContract({
        chain: null,
        account: account ?? undefined,
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'deposit',
        args: [walletId, token, amount],
      });
      return waitForWrite(hash);
    },
    createSessionCap: async (contractAddress, walletId, agent, maxPerInterval, maxTotal, intervalSeconds, expiresAt, name = '') => {
      const hash = await activeWalletClient.writeContract({
        chain: null,
        account: account ?? undefined,
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'createSessionCap',
        args: [walletId, agent, maxPerInterval, maxTotal, intervalSeconds, expiresAt, name],
      });
      return waitForWrite(hash);
    },
    revokeSessionCap: async (contractAddress, capId) => {
      const hash = await activeWalletClient.writeContract({
        chain: null,
        account: account ?? undefined,
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'revokeSessionCap',
        args: [capId],
      });
      return waitForWrite(hash);
    },
    getSessionCap: async (contractAddress, capId) => {
      const cap = await publicClient.readContract({
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'getSessionCap',
        args: [capId],
      });
      return cap as SessionCapInfo;
    },
    getRemainingAllowance: async (contractAddress, capId) => {
      const [intervalRemaining, totalRemaining] = await publicClient.readContract({
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'getRemainingAllowance',
        args: [capId],
      });
      return { intervalRemaining, totalRemaining };
    },
    executeDeposit: async (contractAddress, capId, token, amount, vault, evidenceHash, callData) => {
      const hash = await activeWalletClient.writeContract({
        chain: null,
        account: account ?? undefined,
        address: contractAddress,
        abi: safeflowAbi,
        functionName: 'executeDeposit',
        args: [capId, token, amount, vault, evidenceHash, callData],
      });
      return waitForWrite(hash);
    },
  };
}

export async function createContractRuntime(options: ContractRuntimeOptions): Promise<ContractRuntime> {
  const castBinary = options.backend !== 'viem' ? await resolveCastBinary() : null;
  if (castBinary) {
    return createCastRuntime(castBinary, options.rpcUrl);
  }

  if (options.backend === 'cast') {
    if (options.promptForFoundry === false) {
      throw new Error('cast backend requested but cast is unavailable.');
    }

    const shouldInstall = await askToInstallFoundry();
    if (!shouldInstall) {
      console.log(chalk.yellow('\nFoundry installation skipped. Falling back to viem backend.\n'));
      return createViemRuntime(options.rpcUrl);
    }

    const installedCast = await installFoundry();
    return createCastRuntime(installedCast, options.rpcUrl);
  }

  if (options.backend === 'auto' && options.promptForFoundry !== false) {
    const shouldInstall = await askToInstallFoundry();
    if (shouldInstall) {
      try {
        const installedCast = await installFoundry();
        return createCastRuntime(installedCast, options.rpcUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown Foundry installation failure';
        console.log(chalk.yellow(`\nFoundry installation failed: ${message}`));
        console.log(chalk.yellow('Falling back to viem backend.\n'));
      }
    } else {
      console.log(chalk.yellow('\nFoundry installation skipped. Falling back to viem backend.\n'));
    }
  }

  return createViemRuntime(options.rpcUrl);
}
