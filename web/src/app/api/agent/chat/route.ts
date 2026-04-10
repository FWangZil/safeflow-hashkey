import { NextRequest, NextResponse } from 'next/server';

const EARN_API = 'https://earn.li.fi';

interface ChatRequest {
  message: string;
  history?: { role: string; content: string }[];
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();
    const { message } = body;

    const intent = parseUserIntent(message);

    if (intent.type === 'search_vaults') {
      const params = new URLSearchParams();
      if (intent.chainId) params.set('chainId', String(intent.chainId));
      params.set('limit', '100');

      const res = await fetch(`${EARN_API}/v1/earn/vaults?${params.toString()}`);
      if (!res.ok) throw new Error(`Earn API: ${res.status}`);

      const json = await res.json();
      let vaults = json.data || json;

      // Filter by intent
      if (intent.tokenSymbol) {
        vaults = vaults.filter((v: any) =>
          v.underlyingTokens?.some((t: any) =>
            t.symbol?.toLowerCase() === intent.tokenSymbol!.toLowerCase()
          )
        );
      }
      if (intent.tag) {
        vaults = vaults.filter((v: any) => v.tags?.includes(intent.tag));
      }
      if (intent.minApy) {
        vaults = vaults.filter((v: any) => (v.analytics?.apy?.total ?? 0) >= intent.minApy!);
      }
      if (intent.onlyTransactional !== false) {
        vaults = vaults.filter((v: any) => v.isTransactional === true);
      }

      // Sort by APY descending
      vaults.sort((a: any, b: any) => (b.analytics?.apy?.total ?? 0) - (a.analytics?.apy?.total ?? 0));

      const topVaults = vaults.slice(0, intent.limit || 5);

      if (topVaults.length === 0) {
        return NextResponse.json({
          message: "I couldn't find any vaults matching your criteria. Try broadening your search — for example, remove the chain filter or lower the minimum APY.",
          vaults: [],
        });
      }

      const summary = topVaults
        .map((v: any, i: number) => {
          const apy = v.analytics?.apy?.total?.toFixed(2) ?? 'N/A';
          const tvl = formatTvlShort(v.analytics?.tvl?.usd);
          const tokens = v.underlyingTokens?.map((t: any) => t.symbol).join('/') || '?';
          return `${i + 1}. **${v.name}** (${v.protocol?.name}) — ${apy}% APY, ${tvl} TVL [${tokens} on ${v.network}]`;
        })
        .join('\n');

      const filterDesc = [
        intent.chainName && `on ${intent.chainName}`,
        intent.tokenSymbol && `for ${intent.tokenSymbol}`,
        intent.tag && `tagged "${intent.tag}"`,
        intent.minApy && `with APY ≥ ${intent.minApy}%`,
      ]
        .filter(Boolean)
        .join(', ');

      return NextResponse.json({
        message: `Here are the top ${topVaults.length} yield vaults${filterDesc ? ` ${filterDesc}` : ''}:\n\n${summary}\n\nClick on any vault to view details or start a deposit. Would you like me to help you deposit into any of these?`,
        vaults: topVaults,
      });
    }

    if (intent.type === 'deposit') {
      return NextResponse.json({
        message: `To deposit${intent.tokenSymbol ? ` ${intent.tokenSymbol}` : ''}, I'll need to:\n\n1. Find the best vault matching your criteria\n2. Build the transaction via LI.FI Composer\n3. Submit it through your SafeFlow SessionCap for security\n\nPlease connect your wallet first, then select a vault from the Explorer or tell me more about what you're looking for.`,
        action: { type: 'deposit', token: intent.tokenSymbol },
      });
    }

    if (intent.type === 'portfolio') {
      return NextResponse.json({
        message: "To check your portfolio positions, please connect your wallet first. I'll then fetch your current yield positions from the LI.FI Earn API.\n\nYou can also navigate to the Portfolio tab to see a full breakdown.",
        action: { type: 'info' },
      });
    }

    // Default: general help
    return NextResponse.json({
      message: "I can help you with:\n\n• **Find vaults** — \"Show me stablecoin vaults on Base with APY > 5%\"\n• **Deposit** — \"Deposit 500 USDC into the best vault\"\n• **Portfolio** — \"Show my current positions\"\n• **Compare** — \"Compare USDC vaults on Arbitrum vs Base\"\n\nWhat would you like to do?",
    });
  } catch (error) {
    console.error('Agent chat error:', error);
    return NextResponse.json(
      { message: 'Sorry, something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}

// ─── Intent Parser ─────────────────────────────────────────

interface UserIntent {
  type: 'search_vaults' | 'deposit' | 'portfolio' | 'general';
  chainId?: number;
  chainName?: string;
  tokenSymbol?: string;
  tag?: string;
  minApy?: number;
  limit?: number;
  amount?: number;
  onlyTransactional?: boolean;
}

const CHAIN_MAP: Record<string, number> = {
  ethereum: 1, eth: 1, mainnet: 1,
  arbitrum: 42161, arb: 42161,
  base: 8453,
  optimism: 10, op: 10,
  polygon: 137, matic: 137,
  avalanche: 43114, avax: 43114,
  bsc: 56, bnb: 56,
};

function parseUserIntent(message: string): UserIntent {
  const lower = message.toLowerCase();

  // Portfolio intent
  if (/portfolio|positions?|my (vault|yield|deposit|balance)|holdings/i.test(lower)) {
    return { type: 'portfolio' };
  }

  // Deposit intent
  if (/^deposit|^put|^invest|^allocate|^move.*into/i.test(lower)) {
    const tokenMatch = lower.match(/\b(usdc|usdt|dai|eth|weth|wbtc|wsteth|steth)\b/i);
    const amountMatch = lower.match(/(\d+(?:\.\d+)?)\s*(usdc|usdt|dai|eth|weth|wbtc)/i);
    return {
      type: 'deposit',
      tokenSymbol: tokenMatch?.[1]?.toUpperCase(),
      amount: amountMatch ? parseFloat(amountMatch[1]) : undefined,
    };
  }

  // Search intent
  if (/vault|yield|apy|earn|find|show|search|best|top|list|compare|stablecoin|blue.?chip/i.test(lower)) {
    const intent: UserIntent = { type: 'search_vaults' };

    // Chain
    for (const [name, id] of Object.entries(CHAIN_MAP)) {
      if (lower.includes(name)) {
        intent.chainId = id;
        intent.chainName = name.charAt(0).toUpperCase() + name.slice(1);
        break;
      }
    }

    // Token
    const tokenMatch = lower.match(/\b(usdc|usdt|dai|eth|weth|wbtc|wsteth|steth)\b/i);
    if (tokenMatch) intent.tokenSymbol = tokenMatch[1].toUpperCase();

    // Tags
    if (/stablecoin|stable/i.test(lower)) intent.tag = 'stablecoin';
    else if (/blue.?chip/i.test(lower)) intent.tag = 'blue-chip';
    else if (/lsd|liquid.?staking/i.test(lower)) intent.tag = 'lsd';

    // Min APY
    const apyMatch = lower.match(/(?:apy|apr|yield)\s*(?:>|above|over|>=|at least)\s*(\d+(?:\.\d+)?)/i);
    if (apyMatch) intent.minApy = parseFloat(apyMatch[1]);
    const apyMatch2 = lower.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!apyMatch && apyMatch2) intent.minApy = parseFloat(apyMatch2[1]);

    // Limit
    const limitMatch = lower.match(/top\s*(\d+)/i);
    if (limitMatch) intent.limit = parseInt(limitMatch[1]);

    // Safety filter
    if (/safe|secure|low.?risk/i.test(lower)) {
      intent.onlyTransactional = true;
    }

    return intent;
  }

  return { type: 'general' };
}

function formatTvlShort(tvlUsd: string | undefined): string {
  if (!tvlUsd) return 'N/A';
  const num = Number(tvlUsd);
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}
