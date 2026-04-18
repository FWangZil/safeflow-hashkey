/**
 * Demo merchant registry.
 *
 * The HSP \u00d7 SafeFlow chat demo needs human-friendly payees instead of raw
 * 0x... hex addresses. This file is the single source of truth that maps
 * display names (English + Chinese aliases) to real, fundable addresses on
 * the local HashKey fork. The addresses here are Anvil default accounts
 * #1..#5 so they already exist on any Foundry/Anvil fork with funded
 * balances and can safely receive HSK in the demo.
 *
 * The registry is consumed by:
 *   - src/app/api/agent/chat/route.ts         (resolve merchant names in NL)
 *   - src/components/HspPayActionCard.tsx     (render the payee friendly-name)
 *   - src/app/api/hashkey/hsp-demo/prepare    (merchant_name inside cart)
 */

export interface DemoMerchant {
  id: string;
  /** Primary display name shown in the UI / cart mandate. */
  name: string;
  /** Short tagline (merchant category). */
  tagline: string;
  /** Address that actually receives HSK on-chain. */
  address: `0x${string}`;
  /** Free-text aliases (case-insensitive) the chat parser will match on. */
  aliases: string[];
  /** Rough suggested amount (HSK) used for quick-prompt buttons. */
  suggestedAmount: string;
  /** Suggested memo / reason. */
  suggestedReason: string;
  /** Emoji used in the quick-prompt chip. */
  emoji: string;
}

export const DEMO_MERCHANTS: DemoMerchant[] = [
  {
    id: 'alice-coffee',
    name: "Alice's Coffee Bar",
    tagline: 'Neighborhood coffee shop',
    // Anvil account #1
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    aliases: [
      "alice's coffee bar",
      "alice's coffee",
      'alice coffee',
      'alice',
      'coffee bar',
      'coffee shop',
      '\u5496\u5561',           // \u5496\u5561
      '\u5496\u5561\u5385',     // \u5496\u5561\u5385
      '\u7231\u4e3d\u4e1d',     // \u7231\u4e3d\u4e1d
      '\u7231\u4e3d\u4e1d\u7684\u5496\u5561', // \u7231\u4e3d\u4e1d\u7684\u5496\u5561
    ],
    suggestedAmount: '0.01',
    suggestedReason: 'morning latte',
    emoji: '\u2615\ufe0f',
  },
  {
    id: 'hashkey-merch',
    name: 'HashKey Demo Store',
    tagline: 'Merchant using HSP settlement',
    // Anvil account #2
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    aliases: [
      'hashkey demo store',
      'hashkey store',
      'demo store',
      'hsp store',
      'hsp demo store',
      'merchant',
      'hashkey\u5546\u5e97',                 // HashKey\u5546\u5e97
      'hashkey\u5546\u6237',                 // HashKey\u5546\u6237
      '\u5546\u5e97',                         // \u5546\u5e97
      '\u5546\u6237',                         // \u5546\u6237
    ],
    suggestedAmount: '0.05',
    suggestedReason: 'API subscription',
    emoji: '\ud83d\udee0\ufe0f',
  },
  {
    id: 'safeflow-tipjar',
    name: 'SafeFlow Dev Tip Jar',
    tagline: 'Open-source maintainer donations',
    // Anvil account #3
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    aliases: [
      'safeflow dev tip jar',
      'safeflow tip jar',
      'safeflow devs',
      'safeflow team',
      'tip jar',
      'dev team',
      '\u5f00\u53d1\u8005',                   // \u5f00\u53d1\u8005
      '\u5f00\u53d1\u56e2\u961f',             // \u5f00\u53d1\u56e2\u961f
      '\u6253\u8d4f',                          // \u6253\u8d4f
    ],
    suggestedAmount: '0.1',
    suggestedReason: 'open-source tip',
    emoji: '\ud83d\udc9a',
  },
  {
    id: 'bob-freelancer',
    name: 'Bob the Freelancer',
    tagline: 'Contract engineer invoice',
    // Anvil account #4
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    aliases: [
      'bob the freelancer',
      'bob',
      'freelancer',
      'contractor',
      '\u9c8d\u52c3',           // \u9c8d\u52c3
      '\u5916\u5305',           // \u5916\u5305
      '\u5916\u5305\u5de5\u7a0b\u5e08', // \u5916\u5305\u5de5\u7a0b\u5e08
    ],
    suggestedAmount: '0.25',
    suggestedReason: 'invoice #1042',
    emoji: '\ud83d\udc68\u200d\ud83d\udcbb',
  },
  {
    id: 'charity',
    name: 'Carol Disaster Relief',
    tagline: 'Verified charity donation',
    // Anvil account #5
    address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    aliases: [
      'carol disaster relief',
      'carol relief',
      'disaster relief',
      'charity',
      'donation',
      '\u6148\u5584',           // \u6148\u5584
      '\u6350\u6b3e',           // \u6350\u6b3e
      '\u6551\u707e',           // \u6551\u707e
    ],
    suggestedAmount: '0.5',
    suggestedReason: 'disaster relief donation',
    emoji: '\ud83c\udf0d',
  },
];

/** Lowercase lookup table built once at module load. */
const ALIAS_INDEX: Array<{ token: string; merchant: DemoMerchant }> = DEMO_MERCHANTS.flatMap(m =>
  [m.name, ...m.aliases].map(token => ({ token: token.toLowerCase(), merchant: m })),
).sort((a, b) => b.token.length - a.token.length); // longest-first so "alice coffee" beats "alice"

/**
 * Find a merchant whose display name or alias appears inside `text`.
 * Longest alias wins so that generic ones ("alice") don't mask specific
 * ones ("alice coffee").
 */
export function findMerchantInText(text: string): DemoMerchant | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of ALIAS_INDEX) {
    if (lower.includes(entry.token)) return entry.merchant;
  }
  return null;
}

export function findMerchantByAddress(address: string): DemoMerchant | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  return DEMO_MERCHANTS.find(m => m.address.toLowerCase() === lower) ?? null;
}

export function findMerchantById(id: string): DemoMerchant | null {
  return DEMO_MERCHANTS.find(m => m.id === id) ?? null;
}
