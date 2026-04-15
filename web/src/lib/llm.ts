/**
 * Unified LLM client supporting OpenAI-compatible and Anthropic-compatible APIs.
 *
 * Provider is selected via LLM_PROVIDER env var ("openai" | "anthropic").
 * Falls back to rule-based intent parsing when no API key is configured.
 */

// ─── Types ──────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Config Resolution ──────────────────────────────────────

export function resolveLLMConfig(): LLMConfig | null {
  const provider = (process.env.LLM_PROVIDER || 'openai') as LLMProvider;

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return {
      provider: 'anthropic',
      apiKey,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2048'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
    };
  }

  // Default: OpenAI-compatible
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    provider: 'openai',
    apiKey,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2048'),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
  };
}

// ─── Completion ─────────────────────────────────────────────

export async function chatCompletion(
  messages: LLMMessage[],
  config?: LLMConfig | null,
): Promise<LLMResponse> {
  const cfg = config ?? resolveLLMConfig();
  if (!cfg) {
    throw new Error('No LLM configuration found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  }

  if (cfg.provider === 'anthropic') {
    return callAnthropic(messages, cfg);
  }
  return callOpenAI(messages, cfg);
}

// ─── OpenAI-compatible ──────────────────────────────────────

async function callOpenAI(messages: LLMMessage[], cfg: LLMConfig): Promise<LLMResponse> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content ?? '',
    model: data.model ?? '',
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        }
      : undefined,
  };
}

// ─── Anthropic Messages API ─────────────────────────────────

async function callAnthropic(messages: LLMMessage[], cfg: LLMConfig): Promise<LLMResponse> {
  // Anthropic requires system message separated from the messages array
  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  // Anthropic Messages API requires alternating user/assistant, starting with user
  const anthropicMessages = nonSystemMessages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: cfg.maxTokens ?? 2048,
    temperature: cfg.temperature,
    messages: anthropicMessages,
  };

  if (systemMsg) {
    body.system = systemMsg.content;
  }

  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    content?: Array<{ type: string; text: string }>;
    model?: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  // Anthropic returns content as an array of blocks
  const textContent = data.content
    ?.filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('') ?? '';

  return {
    content: textContent,
    model: data.model ?? '',
    usage: data.usage
      ? {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        }
      : undefined,
  };
}
