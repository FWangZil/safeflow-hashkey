#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';

const EARN_API = 'https://earn.li.fi';

const CHAIN_MAP: Record<string, number> = {
  ethereum: 1, eth: 1,
  arbitrum: 42161, arb: 42161,
  base: 8453,
  optimism: 10, op: 10,
  polygon: 137,
  avalanche: 43114, avax: 43114,
  bsc: 56,
};

interface Vault {
  address: string;
  name: string;
  chainId: number;
  network: string;
  protocol: { name: string };
  tags: string[];
  isTransactional: boolean;
  underlyingTokens: { symbol: string; decimals: number }[];
  analytics: {
    apy: { total: number; base: number; reward: number | null };
    tvl: { usd: string };
  };
}

function formatApy(apy: number | null | undefined): string {
  if (apy == null) return chalk.dim('N/A');
  if (apy >= 10) return chalk.green.bold(`${apy.toFixed(2)}%`);
  if (apy >= 3) return chalk.green(`${apy.toFixed(2)}%`);
  return chalk.yellow(`${apy.toFixed(2)}%`);
}

function formatTvl(usd: string | undefined): string {
  if (!usd) return chalk.dim('N/A');
  const n = Number(usd);
  if (n >= 1e9) return chalk.cyan(`$${(n / 1e9).toFixed(2)}B`);
  if (n >= 1e6) return chalk.cyan(`$${(n / 1e6).toFixed(2)}M`);
  if (n >= 1e3) return chalk.cyan(`$${(n / 1e3).toFixed(0)}K`);
  return chalk.cyan(`$${n.toFixed(0)}`);
}

async function fetchVaults(opts: {
  chainId?: number;
  limit?: number;
}): Promise<Vault[]> {
  const params = new URLSearchParams();
  if (opts.chainId) params.set('chainId', String(opts.chainId));
  if (opts.limit) params.set('limit', String(opts.limit));

  const res = await fetch(`${EARN_API}/v1/earn/vaults?${params.toString()}`);
  if (!res.ok) throw new Error(`Earn API error: ${res.status}`);
  const json = await res.json();
  return json.data || json;
}

const program = new Command();

program
  .name('safeflow')
  .description('SafeFlow Yield Agent CLI — discover and manage DeFi yield vaults')
  .version('0.1.0');

// ─── vault list ──────────────────────────────────────────────

program
  .command('vault')
  .description('Manage yield vaults')
  .command('list')
  .description('List yield vaults from LI.FI Earn API')
  .option('-c, --chain <chain>', 'Filter by chain name (base, arbitrum, ethereum, ...)')
  .option('-t, --token <symbol>', 'Filter by token symbol (USDC, ETH, ...)')
  .option('-p, --protocol <name>', 'Filter by protocol name')
  .option('--tag <tag>', 'Filter by tag (stablecoin, blue-chip, lsd)')
  .option('--min-apy <number>', 'Minimum APY percentage', parseFloat)
  .option('--min-tvl <number>', 'Minimum TVL in USD', parseFloat)
  .option('-n, --limit <number>', 'Number of results', parseInt, 20)
  .option('--sort <field>', 'Sort by field (apy, tvl)', 'apy')
  .option('--asc', 'Sort ascending instead of descending')
  .option('--transactional', 'Only show transactional vaults', true)
  .action(async (opts) => {
    try {
      console.log(chalk.bold('\n🔍 Fetching vaults from LI.FI Earn API...\n'));

      const chainId = opts.chain ? CHAIN_MAP[opts.chain.toLowerCase()] : undefined;
      if (opts.chain && !chainId) {
        console.error(chalk.red(`Unknown chain: ${opts.chain}`));
        console.log(chalk.dim(`Available: ${Object.keys(CHAIN_MAP).filter(k => k.length > 3).join(', ')}`));
        process.exit(1);
      }

      let vaults = await fetchVaults({ chainId, limit: 100 });

      // Filters
      if (opts.transactional) {
        vaults = vaults.filter(v => v.isTransactional === true);
      }
      if (opts.token) {
        const sym = opts.token.toUpperCase();
        vaults = vaults.filter(v => v.underlyingTokens?.some(t => t.symbol?.toUpperCase() === sym));
      }
      if (opts.protocol) {
        const p = opts.protocol.toLowerCase();
        vaults = vaults.filter(v => v.protocol?.name?.toLowerCase().includes(p));
      }
      if (opts.tag) {
        vaults = vaults.filter(v => v.tags?.includes(opts.tag));
      }
      if (opts.minApy != null) {
        vaults = vaults.filter(v => (v.analytics?.apy?.total ?? 0) >= opts.minApy);
      }
      if (opts.minTvl != null) {
        vaults = vaults.filter(v => Number(v.analytics?.tvl?.usd ?? '0') >= opts.minTvl);
      }

      // Sort
      const dir = opts.asc ? 1 : -1;
      if (opts.sort === 'tvl') {
        vaults.sort((a, b) => dir * (Number(a.analytics?.tvl?.usd ?? 0) - Number(b.analytics?.tvl?.usd ?? 0)));
      } else {
        vaults.sort((a, b) => dir * ((a.analytics?.apy?.total ?? 0) - (b.analytics?.apy?.total ?? 0)));
      }

      const display = vaults.slice(0, opts.limit);

      if (display.length === 0) {
        console.log(chalk.yellow('No vaults found matching your criteria.\n'));
        return;
      }

      // Table header
      const header = [
        '#'.padStart(3),
        'Vault'.padEnd(35),
        'Protocol'.padEnd(14),
        'Chain'.padEnd(12),
        'Token'.padEnd(12),
        'APY'.padStart(10),
        'TVL'.padStart(12),
        'Tags',
      ].join('  ');

      console.log(chalk.dim(header));
      console.log(chalk.dim('─'.repeat(header.length + 10)));

      display.forEach((v, i) => {
        const tokens = v.underlyingTokens?.map(t => t.symbol).join('/') || '?';
        const tags = v.tags?.slice(0, 2).join(', ') || '';
        const row = [
          String(i + 1).padStart(3),
          (v.name || '').slice(0, 35).padEnd(35),
          (v.protocol?.name || '').slice(0, 14).padEnd(14),
          (v.network || `${v.chainId}`).padEnd(12),
          tokens.padEnd(12),
          formatApy(v.analytics?.apy?.total).padStart(10),
          formatTvl(v.analytics?.tvl?.usd).padStart(12),
          chalk.dim(tags),
        ].join('  ');
        console.log(row);
      });

      console.log(chalk.dim(`\n${display.length} vaults shown (of ${vaults.length} matching)\n`));
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// ─── vault info ──────────────────────────────────────────────

program
  .command('info')
  .description('Show vault details')
  .argument('<address>', 'Vault contract address')
  .option('-c, --chain <chain>', 'Chain name', 'base')
  .action(async (address, opts) => {
    try {
      const chainId = CHAIN_MAP[opts.chain.toLowerCase()];
      if (!chainId) {
        console.error(chalk.red(`Unknown chain: ${opts.chain}`));
        process.exit(1);
      }

      const vaults = await fetchVaults({ chainId, limit: 100 });
      const vault = vaults.find(v => v.address.toLowerCase() === address.toLowerCase());

      if (!vault) {
        console.log(chalk.yellow(`Vault not found: ${address}`));
        return;
      }

      console.log(`\n${chalk.bold(vault.name)}`);
      console.log(chalk.dim(`${vault.protocol?.name} • ${vault.network}\n`));
      console.log(`  APY (total):  ${formatApy(vault.analytics?.apy?.total)}`);
      console.log(`  APY (base):   ${formatApy(vault.analytics?.apy?.base)}`);
      console.log(`  APY (reward): ${formatApy(vault.analytics?.apy?.reward)}`);
      console.log(`  TVL:          ${formatTvl(vault.analytics?.tvl?.usd)}`);
      console.log(`  Tokens:       ${vault.underlyingTokens?.map(t => t.symbol).join(', ')}`);
      console.log(`  Tags:         ${vault.tags?.join(', ') || 'none'}`);
      console.log(`  Address:      ${chalk.dim(vault.address)}`);
      console.log(`  Transactional: ${vault.isTransactional ? chalk.green('yes') : chalk.red('no')}\n`);
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// ─── portfolio ───────────────────────────────────────────────

program
  .command('portfolio')
  .description('Show yield portfolio positions')
  .argument('<address>', 'Wallet address')
  .action(async (address) => {
    try {
      console.log(chalk.bold(`\n📊 Fetching portfolio for ${chalk.dim(address)}...\n`));

      const res = await fetch(`${EARN_API}/v1/earn/portfolio/${address}/positions`);
      if (!res.ok) {
        if (res.status === 404) {
          console.log(chalk.yellow('No positions found for this address.\n'));
          return;
        }
        throw new Error(`Portfolio API error: ${res.status}`);
      }

      const positions = await res.json();
      if (!Array.isArray(positions) || positions.length === 0) {
        console.log(chalk.yellow('No positions found.\n'));
        return;
      }

      positions.forEach((pos: any, i: number) => {
        console.log(`${chalk.bold(`${i + 1}. ${pos.vault?.name || 'Unknown'}`)}`);
        console.log(`   Protocol: ${pos.vault?.protocol?.name || '?'}`);
        console.log(`   Balance:  ${pos.balanceToken || '?'} ${pos.tokenSymbol || ''} (${chalk.cyan('$' + (pos.balanceUsd || '?'))})`);
        if (pos.pnlUsd) console.log(`   PnL:      ${chalk.green('$' + pos.pnlUsd)}`);
        console.log();
      });
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
