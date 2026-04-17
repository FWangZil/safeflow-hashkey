#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_FILE);
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const CONTRACTS_DIR = join(ROOT_DIR, 'contracts');
const WEB_ENV_PATH = join(ROOT_DIR, 'web', '.env');
const MANIFESTS_DIR = join(ROOT_DIR, 'docs', 'deployments');
const LOCAL_FORK_NETWORK = 'local_base_fork';
const LOCAL_FORK_RPC_DEFAULT = 'http://127.0.0.1:8545';
const LOCAL_FORK_NAME_DEFAULT = 'Base Fork Local';
const HASHKEY_LOCAL_FORK_NETWORK = 'local_hashkey_fork';
const HASHKEY_LOCAL_FORK_RPC_DEFAULT = 'http://127.0.0.1:8546';
const HASHKEY_LOCAL_FORK_NAME_DEFAULT = 'HashKey Fork Local';
const BUILTIN_WALLET_CHAIN_IDS = new Set([1, 8453, 84532, 42161, 421614, 133, 177]);

const NETWORKS = {
  base: {
    kind: 'static',
    chainId: 8453,
    rpcEnvCandidates: ['BASE_RPC_URL', 'RPC_URL'],
  },
  base_sepolia: {
    kind: 'static',
    chainId: 84532,
    rpcEnvCandidates: ['BASE_SEPOLIA_RPC_URL', 'RPC_URL'],
  },
  arbitrum_sepolia: {
    kind: 'static',
    chainId: 421614,
    rpcEnvCandidates: ['ARBITRUM_SEPOLIA_RPC_URL', 'RPC_URL'],
  },
  [LOCAL_FORK_NETWORK]: {
    kind: 'local-fork',
    rpcEnvCandidates: ['NEXT_PUBLIC_LOCAL_FORK_RPC_URL', 'LOCAL_FORK_RPC_URL'],
    defaultRpcUrl: LOCAL_FORK_RPC_DEFAULT,
  },
  hashkey_testnet: {
    kind: 'static',
    chainId: 133,
    rpcEnvCandidates: ['HASHKEY_TESTNET_RPC_URL', 'RPC_URL'],
    defaultRpcUrl: 'https://testnet.hsk.xyz',
  },
  hashkey_mainnet: {
    kind: 'static',
    chainId: 177,
    rpcEnvCandidates: ['HASHKEY_MAINNET_RPC_URL', 'RPC_URL'],
    defaultRpcUrl: 'https://mainnet.hsk.xyz',
  },
  [HASHKEY_LOCAL_FORK_NETWORK]: {
    kind: 'hashkey-fork',
    sourceChainId: 133,
    sourceName: 'HashKey Testnet',
    rpcEnvCandidates: ['NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL', 'HASHKEY_LOCAL_FORK_RPC_URL'],
    defaultRpcUrl: HASHKEY_LOCAL_FORK_RPC_DEFAULT,
    defaultForkRpc: 'https://testnet.hsk.xyz',
  },
};

function printHelp() {
  console.log(`Usage: node scripts/deploy-contract-and-configure-web.mjs [options]\n\nOptions:\n  --network <name>           Target network (${Object.keys(NETWORKS).join(', ')})\n  --contract <type>          Contract variant: 'default' or 'hashkey' (default: auto-detect from network)\n  --force                    Force redeploy even if a deployment already exists\n  --web-env <path>           Override web env file path\n  --sync-local-fork-env      When deploying to local_base_fork, sync NEXT_PUBLIC_LOCAL_FORK_* values\n  --sync-hashkey-fork-env    When deploying to local_hashkey_fork, sync NEXT_PUBLIC_HASHKEY_LOCAL_FORK_* values\n  --configure-local-fork     Alias for --sync-local-fork-env / --sync-hashkey-fork-env\n  --help                     Show this help\n`);
}

function parseArgs(argv) {
  const options = {
    network: process.env.SAFEFLOW_NETWORK || 'base_sepolia',
    contract: null,
    force: false,
    syncLocalForkEnv: false,
    syncHashkeyForkEnv: false,
    webEnvPath: WEB_ENV_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--sync-local-fork-env') {
      options.syncLocalForkEnv = true;
      continue;
    }
    if (arg === '--sync-hashkey-fork-env') {
      options.syncHashkeyForkEnv = true;
      continue;
    }
    if (arg === '--configure-local-fork') {
      options.syncLocalForkEnv = true;
      options.syncHashkeyForkEnv = true;
      continue;
    }
    if (arg === '--network') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --network');
      options.network = value;
      index += 1;
      continue;
    }
    if (arg === '--contract') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --contract');
      if (value !== 'default' && value !== 'hashkey') {
        throw new Error(`Invalid --contract value: ${value}. Expected 'default' or 'hashkey'.`);
      }
      options.contract = value;
      index += 1;
      continue;
    }
    if (arg === '--web-env') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --web-env');
      options.webEnvPath = resolve(ROOT_DIR, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  // Auto-detect contract variant from network if not specified
  if (!options.contract) {
    options.contract = (options.network.startsWith('hashkey_') || options.network === HASHKEY_LOCAL_FORK_NETWORK)
      ? 'hashkey' : 'default';
  }

  return options;
}

function requireNetworkConfig(network) {
  const config = NETWORKS[network];
  if (!config) {
    throw new Error(`Unsupported network: ${network}. Expected one of ${Object.keys(NETWORKS).join(', ')}`);
  }
  return config;
}

function parseIntegerEnv(name, fallbackValue) {
  const rawValue = process.env[name];
  if (!rawValue) return fallbackValue;

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer, received ${rawValue}`);
  }

  return parsed;
}

function resolveLocalForkConfig(networkConfig) {
  const chainId = parseIntegerEnv('NEXT_PUBLIC_LOCAL_FORK_CHAIN_ID', 31337);
  const sourceChainId = parseIntegerEnv('NEXT_PUBLIC_LOCAL_FORK_SOURCE_CHAIN_ID', 8453);

  if (BUILTIN_WALLET_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `NEXT_PUBLIC_LOCAL_FORK_CHAIN_ID=${chainId} conflicts with a built-in wallet chain. Use a dedicated local chain id such as 31337.`,
    );
  }

  let rpcUrl = networkConfig.defaultRpcUrl;
  let rpcEnvName = 'default:localhost';

  for (const envName of networkConfig.rpcEnvCandidates) {
    const value = process.env[envName];
    if (value) {
      rpcUrl = value;
      rpcEnvName = envName;
      break;
    }
  }

  return {
    rpcUrl,
    rpcEnvName,
    chainId,
    sourceChainId,
    chainName: process.env.NEXT_PUBLIC_LOCAL_FORK_NAME || LOCAL_FORK_NAME_DEFAULT,
    explorerUrl: process.env.NEXT_PUBLIC_LOCAL_FORK_EXPLORER_URL || '',
    isLocalFork: true,
  };
}

function resolveHashkeyLocalForkConfig(networkConfig) {
  const chainId = parseIntegerEnv('NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID', 31338);
  const sourceChainId = networkConfig.sourceChainId;

  if (BUILTIN_WALLET_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID=${chainId} conflicts with a built-in wallet chain. Use a dedicated local chain id such as 31338.`,
    );
  }

  let rpcUrl = networkConfig.defaultRpcUrl;
  let rpcEnvName = 'default:localhost';

  for (const envName of networkConfig.rpcEnvCandidates) {
    const value = process.env[envName];
    if (value) {
      rpcUrl = value;
      rpcEnvName = envName;
      break;
    }
  }

  return {
    rpcUrl,
    rpcEnvName,
    chainId,
    sourceChainId,
    chainName: process.env.NEXT_PUBLIC_HASHKEY_LOCAL_FORK_NAME || HASHKEY_LOCAL_FORK_NAME_DEFAULT,
    explorerUrl: process.env.NEXT_PUBLIC_HASHKEY_LOCAL_FORK_EXPLORER_URL || '',
    forkRpcUrl: networkConfig.defaultForkRpc,
    isLocalFork: true,
    isHashkeyFork: true,
  };
}

function resolveRpcConfig(network) {
  const networkConfig = requireNetworkConfig(network);
  if (networkConfig.kind === 'local-fork') {
    return resolveLocalForkConfig(networkConfig);
  }
  if (networkConfig.kind === 'hashkey-fork') {
    return resolveHashkeyLocalForkConfig(networkConfig);
  }

  for (const envName of networkConfig.rpcEnvCandidates) {
    const value = process.env[envName];
    if (value) {
      return { rpcUrl: value, rpcEnvName: envName, chainId: networkConfig.chainId, isLocalFork: false };
    }
  }

  // Use defaultRpcUrl if available (e.g., hashkey networks)
  if (networkConfig.defaultRpcUrl) {
    return { rpcUrl: networkConfig.defaultRpcUrl, rpcEnvName: 'default', chainId: networkConfig.chainId, isLocalFork: false };
  }

  throw new Error(`Missing RPC URL for ${network}. Set one of ${networkConfig.rpcEnvCandidates.join(', ')}`);
}

function requirePrivateKey() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('Missing PRIVATE_KEY in environment.');
  }
  return privateKey;
}

async function commandExists(command, args = ['--version']) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => resolvePromise(false));
    child.on('exit', code => resolvePromise(code === 0));
  });
}

async function ensureForgeInstalled() {
  const installed = await commandExists('forge');
  if (!installed) {
    throw new Error('Foundry `forge` command is required. Install Foundry first, then rerun this script.');
  }
}

async function readTextFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function parseEnvValue(content, key) {
  const pattern = new RegExp(`^${key}=(.*)$`, 'm');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildEnvFileContent(existing, updates) {
  let nextContent = existing;

  for (const [key, value] of Object.entries(updates)) {
    if (value == null) continue;

    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');

    if (pattern.test(nextContent)) {
      nextContent = nextContent.replace(pattern, line);
      continue;
    }

    nextContent = `${nextContent.replace(/\s*$/, '\n')}${line}\n`;
  }

  return nextContent || '';
}

async function fetchContractCode(rpcUrl, address) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getCode',
      params: [address, 'latest'],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message || 'unknown error'}`);
  }

  return typeof json.result === 'string' ? json.result : '0x';
}

async function isLiveContract(rpcUrl, address) {
  if (!address || address === ZERO_ADDRESS) return false;
  const code = await fetchContractCode(rpcUrl, address);
  return code !== '0x' && code !== '0x0';
}

async function findLatestManifestForNetwork(network) {
  const latestPointerPath = join(MANIFESTS_DIR, `latest.${network}.json`);
  const latestPointerContent = await readTextFile(latestPointerPath);
  if (latestPointerContent) {
    return { path: latestPointerPath, data: JSON.parse(latestPointerContent) };
  }

  try {
    const entries = await readdir(MANIFESTS_DIR);
    const candidates = entries
      .filter(entry => entry.endsWith(`-${network}.json`))
      .sort()
      .reverse();

    for (const candidate of candidates) {
      const fullPath = join(MANIFESTS_DIR, candidate);
      const content = await readTextFile(fullPath);
      if (content) {
        return { path: fullPath, data: JSON.parse(content) };
      }
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  return null;
}

async function resolveExistingDeployment(network, rpcUrl, webEnvPath) {
  const manifestRecord = await findLatestManifestForNetwork(network);
  if (manifestRecord) {
    const address = manifestRecord.data?.contracts?.SafeFlowVault || manifestRecord.data?.contractAddress;
    if (typeof address === 'string' && await isLiveContract(rpcUrl, address)) {
      return {
        address,
        source: 'manifest',
        sourcePath: manifestRecord.path,
      };
    }
  }

  const webEnvContent = await readTextFile(webEnvPath);
  const envAddress = parseEnvValue(webEnvContent, 'NEXT_PUBLIC_SAFEFLOW_CONTRACT');
  if (envAddress && await isLiveContract(rpcUrl, envAddress)) {
    return {
      address: envAddress,
      source: 'web-env',
      sourcePath: webEnvPath,
    };
  }

  return null;
}

const CONTRACT_VARIANTS = {
  default: {
    scriptPath: 'script/Deploy.s.sol:DeployScript',
    addressPatterns: [
      /SafeFlowVault deployed at:\s*(0x[a-fA-F0-9]{40})/,
      /Deployed to:\s*(0x[a-fA-F0-9]{40})/,
    ],
    envKey: 'NEXT_PUBLIC_SAFEFLOW_CONTRACT',
    manifestKey: 'SafeFlowVault',
  },
  hashkey: {
    scriptPath: 'script/DeployHashKey.s.sol:DeployHashKeyScript',
    addressPatterns: [
      /SafeFlowVaultHashKey deployed at:\s*(0x[a-fA-F0-9]{40})/,
      /Deployed to:\s*(0x[a-fA-F0-9]{40})/,
    ],
    envKey: 'NEXT_PUBLIC_HASHKEY_CONTRACT',
    manifestKey: 'SafeFlowVaultHashKey',
  },
};

async function runForgeDeploy(rpcUrl, contractVariant = 'default') {
  await ensureForgeInstalled();
  requirePrivateKey();

  const variant = CONTRACT_VARIANTS[contractVariant];
  if (!variant) throw new Error(`Unknown contract variant: ${contractVariant}`);

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'forge',
      ['script', variant.scriptPath, '--rpc-url', rpcUrl, '--broadcast'],
      {
        cwd: CONTRACTS_DIR,
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe'],
      },
    );

    let combinedOutput = '';

    const collect = chunk => {
      const text = chunk.toString();
      combinedOutput += text;
      return text;
    };

    child.stdout.on('data', chunk => {
      process.stdout.write(collect(chunk));
    });

    child.stderr.on('data', chunk => {
      process.stderr.write(collect(chunk));
    });

    child.on('error', rejectPromise);
    child.on('exit', code => {
      if (code !== 0) {
        rejectPromise(new Error(`forge script exited with code ${code ?? 'unknown'}`));
        return;
      }

      const matches = variant.addressPatterns.map(pattern => combinedOutput.match(pattern));
      const address = matches.find(Boolean)?.[1];
      if (!address) {
        rejectPromise(new Error('Deployment succeeded but contract address could not be parsed from forge output.'));
        return;
      }

      resolvePromise(address);
    });
  });
}

async function updateWebEnv(webEnvPath, updates) {
  const existing = await readTextFile(webEnvPath);
  const nextContent = buildEnvFileContent(existing, updates);
  await writeFile(webEnvPath, nextContent, 'utf8');
}

function buildLocalForkEnvUpdates(networkRuntime) {
  return {
    NEXT_PUBLIC_LOCAL_FORK_ENABLED: 'true',
    NEXT_PUBLIC_LOCAL_FORK_CHAIN_ID: String(networkRuntime.chainId),
    NEXT_PUBLIC_LOCAL_FORK_SOURCE_CHAIN_ID: String(networkRuntime.sourceChainId),
    NEXT_PUBLIC_LOCAL_FORK_RPC_URL: networkRuntime.rpcUrl,
    NEXT_PUBLIC_LOCAL_FORK_NAME: networkRuntime.chainName,
    NEXT_PUBLIC_LOCAL_FORK_EXPLORER_URL: networkRuntime.explorerUrl,
  };
}

function buildHashkeyLocalForkEnvUpdates(networkRuntime) {
  return {
    NEXT_PUBLIC_HASHKEY_ENABLED: 'true',
    NEXT_PUBLIC_HASHKEY_LOCAL_FORK_ENABLED: 'true',
    NEXT_PUBLIC_HASHKEY_LOCAL_FORK_CHAIN_ID: String(networkRuntime.chainId),
    NEXT_PUBLIC_HASHKEY_LOCAL_FORK_RPC_URL: networkRuntime.rpcUrl,
    NEXT_PUBLIC_HASHKEY_LOCAL_FORK_NAME: networkRuntime.chainName,
    NEXT_PUBLIC_HASHKEY_LOCAL_FORK_EXPLORER_URL: networkRuntime.explorerUrl,
  };
}

function toFileTimestamp(isoString) {
  return isoString.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function writeDeploymentRecords(record) {
  await mkdir(MANIFESTS_DIR, { recursive: true });
  const timestamp = toFileTimestamp(record.timestamp);
  const historyPath = join(MANIFESTS_DIR, `${timestamp}-${record.network}.json`);
  const latestPath = join(MANIFESTS_DIR, `latest.${record.network}.json`);
  const content = `${JSON.stringify(record, null, 2)}\n`;

  await writeFile(historyPath, content, 'utf8');
  await writeFile(latestPath, content, 'utf8');

  return { historyPath, latestPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.syncLocalForkEnv && options.network !== LOCAL_FORK_NETWORK) {
    throw new Error('--sync-local-fork-env is only supported with --network local_base_fork');
  }
  if (options.syncHashkeyForkEnv && options.network !== HASHKEY_LOCAL_FORK_NETWORK) {
    throw new Error('--sync-hashkey-fork-env is only supported with --network local_hashkey_fork');
  }

  const networkRuntime = resolveRpcConfig(options.network);
  const { rpcUrl, rpcEnvName, chainId } = networkRuntime;
  const existing = options.force ? null : await resolveExistingDeployment(options.network, rpcUrl, options.webEnvPath);

  const variant = CONTRACT_VARIANTS[options.contract];
  const contractLabel = variant.manifestKey;

  let address;
  let status;
  let source;
  let sourcePath = null;

  if (existing) {
    address = existing.address;
    status = 'reused';
    source = existing.source;
    sourcePath = existing.sourcePath;
    console.log(`Using existing ${contractLabel} on ${options.network}: ${address}`);
  } else {
    console.log(`Deploying ${contractLabel} to ${options.network}...`);
    address = await runForgeDeploy(rpcUrl, options.contract);
    status = 'deployed';
    source = 'forge-script';
    console.log(`Deployed ${contractLabel} to ${address}`);
  }

  const live = await isLiveContract(rpcUrl, address);
  if (!live) {
    throw new Error(`No contract code found at ${address} on ${options.network}`);
  }

  const webEnvUpdates = {
    [variant.envKey]: address,
    ...(options.syncLocalForkEnv && networkRuntime.isLocalFork ? buildLocalForkEnvUpdates(networkRuntime) : {}),
    ...(options.syncHashkeyForkEnv && networkRuntime.isHashkeyFork ? buildHashkeyLocalForkEnvUpdates(networkRuntime) : {}),
    ...(options.contract === 'hashkey' && !networkRuntime.isHashkeyFork ? { NEXT_PUBLIC_HASHKEY_ENABLED: 'true' } : {}),
  };

  await updateWebEnv(options.webEnvPath, webEnvUpdates);

  const record = {
    timestamp: new Date().toISOString(),
    network: options.network,
    chainId,
    status,
    forceRedeploy: options.force,
    rpcEnvName,
    contractVariant: options.contract,
    contracts: {
      [contractLabel]: address,
    },
    webEnvFile: options.webEnvPath,
    webEnv: webEnvUpdates,
    source,
    sourcePath,
    ...(networkRuntime.isLocalFork
      ? {
          runtime: {
            mode: LOCAL_FORK_NETWORK,
            executionChainId: chainId,
            sourceChainId: networkRuntime.sourceChainId,
            executionChainName: networkRuntime.chainName,
            rpcUrl: networkRuntime.rpcUrl,
            rpcEnvName,
            explorerUrl: networkRuntime.explorerUrl || null,
            webEnvSynchronized: options.syncLocalForkEnv,
          },
        }
      : {}),
  };

  const { historyPath, latestPath } = await writeDeploymentRecords(record);

  console.log('');
  console.log(`Web env updated: ${options.webEnvPath}`);
  console.log(`Deployment record: ${historyPath}`);
  console.log(`Latest record: ${latestPath}`);
  if (networkRuntime.isLocalFork && !networkRuntime.isHashkeyFork) {
    console.log(`Local fork runtime sync: ${options.syncLocalForkEnv ? 'enabled' : 'skipped'}`);
  }
  if (networkRuntime.isHashkeyFork) {
    console.log(`HashKey fork runtime sync: ${options.syncHashkeyForkEnv ? 'enabled' : 'skipped'}`);
  }
  console.log('');
  console.log('You can now start the web app with:');
  console.log('  npm run dev');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
