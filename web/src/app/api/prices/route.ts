import { NextRequest, NextResponse } from 'next/server';

// Tokens pegged 1:1 to USD — no query needed
const STABLECOINS: Record<string, true> = {
  USDC: true, USDT: true, DAI: true, BUSD: true, FRAX: true,
  LUSD: true, USDBC: true, USDS: true, CRVUSD: true, PYUSD: true,
  USDPLUS: true, DOLA: true,
};

// Alias: token symbol → canonical Binance base asset
const SYMBOL_ALIAS: Record<string, string> = {
  WETH: 'ETH',
  WSOL: 'SOL',
  WBTC: 'BTC',
};

// Binance quote currencies to try, in priority order
const QUOTE_LADDER: Array<{ quote: string; convertVia: string }> = [
  { quote: 'USDT', convertVia: '' },
  { quote: 'BUSD', convertVia: 'BUSDUSDT' },
  { quote: 'EUR',  convertVia: 'EURUSDT' },
  { quote: 'BTC',  convertVia: 'BTCUSDT' },
  { quote: 'ETH',  convertVia: 'ETHUSDT' },
  { quote: 'BNB',  convertVia: 'BNBUSDT' },
];

// USDC contract addresses for LI.FI quote fallback
const USDC_BY_CHAIN: Record<number, string> = {
  1:     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  8453:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  10:    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  137:   '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
};

interface BinanceTicker {
  symbol: string;
  price: string;
}

interface TokenContext {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
}

function parseTokenInfo(raw: string): TokenContext[] {
  return raw.split(',').map(entry => {
    const parts = entry.split(':');
    if (parts.length < 3) return null;
    return {
      chainId: Number(parts[0]),
      address: parts[1],
      symbol: parts[2].toUpperCase(),
      decimals: parts[3] ? Number(parts[3]) : 18,
    };
  }).filter((t): t is TokenContext => t != null && !isNaN(t.chainId) && t.address.startsWith('0x'));
}

/** Use LI.FI quote API as fallback: swap 1 token → USDC to derive USD price. */
async function getLiFiPrice(token: TokenContext): Promise<number | null> {
  const usdc = USDC_BY_CHAIN[token.chainId];
  if (!usdc || !token.address || token.address === '0x0000000000000000000000000000000000000000') return null;

  const apiKey = process.env.LIFI_API_KEY;
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (apiKey) headers['x-lifi-api-key'] = apiKey;

  const fromAmount = BigInt(10 ** token.decimals).toString();
  const params = new URLSearchParams({
    fromChain: String(token.chainId),
    toChain: String(token.chainId),
    fromToken: token.address,
    toToken: usdc,
    fromAmount,
    fromAddress: '0x0000000000000000000000000000000000000001',
  });

  try {
    const res = await fetch(`https://li.quest/v1/quote?${params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      estimate?: { toAmount?: string; toAmountUSD?: string };
    };
    // toAmount is in USDC smallest unit (6 decimals) → price per 1 token
    if (data.estimate?.toAmount) {
      return Number(data.estimate.toAmount) / 1e6;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const rawSymbols = req.nextUrl.searchParams.get('symbols') ?? '';
  const rawTokenInfo = req.nextUrl.searchParams.get('tokenInfo') ?? '';

  const symbols = rawSymbols
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({});
  }

  const result: Record<string, number> = {};

  // Build token context map for LI.FI fallback
  const tokenCtxMap = new Map<string, TokenContext>();
  for (const tc of parseTokenInfo(rawTokenInfo)) {
    if (!tokenCtxMap.has(tc.symbol)) tokenCtxMap.set(tc.symbol, tc);
  }

  // Stablecoins — price is exactly $1
  const toResolve = symbols.filter((sym) => {
    if (STABLECOINS[sym]) {
      result[sym] = 1.0;
      return false;
    }
    return true;
  });

  if (toResolve.length > 0) {
    // Phase 1: Binance — fast, cached, covers most tokens
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/price', {
        next: { revalidate: 60 },
      });
      if (res.ok) {
        const data = (await res.json()) as BinanceTicker[];
        const all = new Map<string, number>();
        for (const { symbol, price } of data) {
          all.set(symbol, parseFloat(price));
        }

        const resolveViaLadder = (sym: string): number | null => {
          const base = SYMBOL_ALIAS[sym] ?? sym;
          for (const { quote, convertVia } of QUOTE_LADDER) {
            const pairPrice = all.get(`${base}${quote}`);
            if (pairPrice == null) continue;
            if (!convertVia) return pairPrice;
            const rate = all.get(convertVia);
            if (rate) return pairPrice * rate;
          }
          if (base !== sym) {
            for (const { quote, convertVia } of QUOTE_LADDER) {
              const pairPrice = all.get(`${sym}${quote}`);
              if (pairPrice == null) continue;
              if (!convertVia) return pairPrice;
              const rate = all.get(convertVia);
              if (rate) return pairPrice * rate;
            }
          }
          return null;
        };

        for (const sym of toResolve) {
          const price = resolveViaLadder(sym);
          if (price != null) result[sym] = price;
        }
      }
    } catch {
      // Partial results — at least stablecoins are present
    }

    // Phase 2: LI.FI quote fallback for anything Binance couldn't price
    const unresolved = toResolve.filter(sym => result[sym] == null);
    if (unresolved.length > 0) {
      await Promise.allSettled(
        unresolved
          .map(sym => ({ sym, ctx: tokenCtxMap.get(sym) }))
          .filter(({ ctx }) => ctx != null)
          .map(async ({ sym, ctx }) => {
            const price = await getLiFiPrice(ctx!);
            if (price != null) result[sym] = price;
          })
      );
    }
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  });
}
