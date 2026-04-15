import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion, resolveLLMConfig, type LLMMessage } from '@/lib/llm';

const EARN_API = 'https://earn.li.fi';

interface ChatRequest {
  message: string;
  history?: { role: string; content: string }[];
}

// ─── System Prompt for LLM Mode ─────────────────────────────

const SYSTEM_PROMPT = `You are SafeFlow Yield Agent — an AI assistant that helps users manage DeFi yield strategies securely.

You have access to real-time vault data that will be injected into the conversation. Your job is to:
1. Understand the user's yield goals (risk tolerance, preferred tokens, chains, APY targets)
2. Analyze the available vault data to find the best opportunities
3. Explain your reasoning clearly, including risk considerations
4. Guide users through the deposit process via SafeFlow's SessionCap security model

Key concepts:
- SafeFlow uses SessionCaps to limit AI agent spending (per-interval limits, total limits, expiry)
- Deposits go through the SafeFlowVault contract which enforces these limits on-chain
- Vault data comes from LI.FI Earn API (20+ protocols across EVM chains)

When recommending vaults, always mention:
- APY (total, base, reward breakdown if significant)
- TVL (higher = generally safer)
- Protocol name and chain
- Risk factors (e.g. low TVL, new protocol, impermanent loss for LP vaults)

Format your responses in Markdown. Be concise but informative.
If the user asks something unrelated to DeFi yield, politely redirect them.

IMPORTANT: When you identify that the user wants to search for vaults, include a JSON block at the end of your response wrapped in <tool_call> tags:
<tool_call>{"action":"search_vaults","chainId":8453,"token":"USDC","tag":"stablecoin","minApy":5,"limit":5}</tool_call>

Only include fields that the user explicitly mentioned. Valid fields:
- action: "search_vaults" | "deposit" | "portfolio"
- chainId: number (1=Ethereum, 8453=Base, 42161=Arbitrum, 10=Optimism, 137=Polygon)
- token: string (USDC, ETH, WBTC, etc.)
- tag: "stablecoin" | "blue-chip" | "lsd"
- minApy: number
- limit: number (default 5)`;

// ─── Route Handler ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();
    const { message, history } = body;

    const llmConfig = resolveLLMConfig();

    // If LLM is configured, use it for reasoning; otherwise fall back to rule-based
    if (llmConfig) {
      return handleWithLLM(message, history || [], llmConfig);
    }
    return handleWithRules(message);
  } catch (error) {
    console.error('Agent chat error:', error);
    return NextResponse.json(
      { message: 'Sorry, something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}

// ─── LLM-Powered Handler ────────────────────────────────────

async function handleWithLLM(
  message: string,
  history: { role: string; content: string }[],
  llmConfig: NonNullable<ReturnType<typeof resolveLLMConfig>>,
) {
  // Build message history for the LLM
  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Add conversation history (last 10 messages)
  for (const msg of history.slice(-10)) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: message });

  // Call LLM
  const llmResponse = await chatCompletion(messages, llmConfig);
  let responseText = llmResponse.content;

  // Extract tool call if present
  const toolCallMatch = responseText.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
  let vaults: any[] = [];

  if (toolCallMatch) {
    // Remove tool_call from visible response
    responseText = responseText.replace(/<tool_call>[\s\S]*?<\/tool_call>/, '').trim();

    try {
      const toolCall = JSON.parse(toolCallMatch[1]);

      if (toolCall.action === 'search_vaults') {
        vaults = await fetchAndFilterVaults(toolCall);

        // Append vault summary to response if LLM didn't include it
        if (vaults.length > 0 && !responseText.includes('APY')) {
          const summary = vaults
            .slice(0, toolCall.limit || 5)
            .map((v: any, i: number) => {
              const apy = v.analytics?.apy?.total?.toFixed(2) ?? 'N/A';
              const tvl = formatTvlShort(v.analytics?.tvl?.usd);
              const tokens = v.underlyingTokens?.map((t: any) => t.symbol).join('/') || '?';
              return `${i + 1}. **${v.name}** (${v.protocol?.name}) — ${apy}% APY, ${tvl} TVL [${tokens} on ${v.network}]`;
            })
            .join('\n');
          responseText += `\n\n${summary}`;
        }
      }

      if (toolCall.action === 'portfolio') {
        return NextResponse.json({
          message: responseText,
          action: { type: 'info' },
        });
      }

      if (toolCall.action === 'deposit') {
        return NextResponse.json({
          message: responseText,
          action: { type: 'deposit', token: toolCall.token },
        });
      }
    } catch {
      // Tool call parse failed — just return the text
    }
  }

  return NextResponse.json({
    message: responseText,
    vaults: vaults.slice(0, 5),
    provider: llmConfig.provider,
    model: llmResponse.model,
  });
}

// ─── Shared: Fetch & Filter Vaults ──────────────────────────

async function fetchAndFilterVaults(params: {
  chainId?: number;
  token?: string;
  tag?: string;
  minApy?: number;
  limit?: number;
}): Promise<any[]> {
  const qs = new URLSearchParams();
  if (params.chainId) qs.set('chainId', String(params.chainId));
  qs.set('limit', '100');

  const res = await fetch(`${EARN_API}/v1/earn/vaults?${qs.toString()}`);
  if (!res.ok) throw new Error(`Earn API: ${res.status}`);

  const json = await res.json() as { data?: any[]; [key: string]: any };
  let vaults = json.data || json;

  if (params.token) {
    const sym = params.token.toUpperCase();
    vaults = vaults.filter((v: any) =>
      v.underlyingTokens?.some((t: any) => t.symbol?.toUpperCase() === sym)
    );
  }
  if (params.tag) {
    vaults = vaults.filter((v: any) => v.tags?.includes(params.tag));
  }
  if (params.minApy != null) {
    vaults = vaults.filter((v: any) => (v.analytics?.apy?.total ?? 0) >= params.minApy!);
  }
  // Always filter to transactional vaults
  vaults = vaults.filter((v: any) => v.isTransactional === true);

  vaults.sort((a: any, b: any) => (b.analytics?.apy?.total ?? 0) - (a.analytics?.apy?.total ?? 0));

  return vaults.slice(0, params.limit || 5);
}

// ─── Rule-Based Fallback Handler ────────────────────────────

async function handleWithRules(message: string) {
  const intent = parseUserIntent(message);

  if (intent.type === 'search_vaults') {
    const vaults = await fetchAndFilterVaults({
      chainId: intent.chainId,
      token: intent.tokenSymbol,
      tag: intent.tag,
      minApy: intent.minApy,
      limit: intent.limit,
    });

    if (vaults.length === 0) {
      return NextResponse.json({
        message: "I couldn't find any vaults matching your criteria. Try broadening your search — for example, remove the chain filter or lower the minimum APY.",
        vaults: [],
      });
    }

    const summary = vaults
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
      message: `Here are the top ${vaults.length} yield vaults${filterDesc ? ` ${filterDesc}` : ''}:\n\n${summary}\n\nClick on any vault to view details or start a deposit.`,
      vaults,
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

  return NextResponse.json({
    message: "I can help you with:\n\n• **Find vaults** — \"Show me stablecoin vaults on Base with APY > 5%\"\n• **Deposit** — \"Deposit 500 USDC into the best vault\"\n• **Portfolio** — \"Show my current positions\"\n• **Compare** — \"Compare USDC vaults on Arbitrum vs Base\"\n\nWhat would you like to do?\n\n_💡 Tip: Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env.local` to enable AI-powered reasoning._",
  });
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
