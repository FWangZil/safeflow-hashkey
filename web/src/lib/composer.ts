import type { ComposerQuote } from '@/types';

const COMPOSER_API_BASE = 'https://li.quest';

export interface LiFiRouteStep {
  type: string;
  tool: string;
  toolDetails?: { name: string; logoURI?: string; key?: string };
  action?: {
    fromToken: { symbol: string; address: string };
    toToken: { symbol: string; address: string };
    fromAmount: string;
    toAmount?: string;
  };
  estimate?: { toAmount?: string; gasCosts?: { amountUSD?: string }[] };
}

export interface LiFiRoute {
  id: string;
  steps: LiFiRouteStep[];
  gasCostUSD?: string;
  tags?: string[];
}

export async function getRoutes(params: {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAddress: string;
  fromAmount: string;
}): Promise<LiFiRoute[]> {
  const searchParams = new URLSearchParams({
    fromChainId: String(params.fromChainId),
    toChainId: String(params.toChainId),
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAddress: params.fromAddress,
    fromAmount: params.fromAmount,
  });

  const res = await fetch(`/api/earn/routes?${searchParams.toString()}`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.routes ?? [];
}

export interface QuoteParams {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAddress: string;
  toAddress: string;
  fromAmount: string;
}

export async function getQuote(params: QuoteParams): Promise<ComposerQuote> {
  const apiKey = process.env.NEXT_PUBLIC_LIFI_API_KEY;

  const searchParams = new URLSearchParams({
    fromChain: String(params.fromChain),
    toChain: String(params.toChain),
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    fromAmount: params.fromAmount,
  });

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['x-lifi-api-key'] = apiKey;
  }

  const res = await fetch(`${COMPOSER_API_BASE}/v1/quote?${searchParams.toString()}`, {
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Composer quote error (${res.status}): ${errorText}`);
  }

  return res.json();
}

export function parseTokenAmount(amount: string | number, decimals: number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return BigInt(Math.round(num * 10 ** decimals)).toString();
}

export function formatTokenAmount(amount: string, decimals: number): string {
  const num = Number(amount) / 10 ** decimals;
  if (num < 0.01) return num.toExponential(2);
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals > 6 ? 6 : decimals });
}
