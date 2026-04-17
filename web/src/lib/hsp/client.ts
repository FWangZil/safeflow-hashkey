/**
 * HSP (HashKey Settlement Protocol) Client
 *
 * Migrated from safeflow-hashkey/sdk/src/hsp.ts.
 * Implements the HashKey Merchant API for creating payment orders,
 * querying payment status, and verifying webhook signatures.
 *
 * Authentication:
 *   - HMAC-SHA256 request signing on every API call
 *   - ES256K JWT for merchant_authorization in Cart Mandates
 */

import { type HspEnvironment, HSP_BASE_URLS, HSP_TESTNET_TOKENS, HSP_MAINNET_TOKENS } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HspPaymentStatus =
  | 'payment-required'
  | 'payment-submitted'
  | 'payment-verified'
  | 'payment-processing'
  | 'payment-included'
  | 'payment-successful'
  | 'payment-failed';

export interface HspClientConfig {
  appKey: string;
  appSecret: string;
  environment?: HspEnvironment;
  baseUrl?: string;
  timeoutMs?: number;
  merchantPrivateKeyHex?: string;
  merchantName?: string;
}

export interface HspMethodData {
  supported_methods: string;
  data: {
    x402Version: number;
    network: string;
    chain_id: number;
    contract_address: string;
    pay_to: string;
    coin: string;
  };
}

export interface HspDisplayItem {
  label: string;
  amount: { currency: string; value: string };
}

export interface HspCartMandateContents {
  id: string;
  user_cart_confirmation_required: boolean;
  payment_request: {
    method_data: HspMethodData[];
    details: {
      id: string;
      display_items?: HspDisplayItem[];
      total: { label: string; amount: { currency: string; value: string } };
    };
  };
  cart_expiry: string;
  merchant_name: string;
}

export interface HspCreateOrderRequest {
  cart_mandate: {
    contents: HspCartMandateContents;
    merchant_authorization: string;
  };
  redirect_url?: string;
}

export interface HspCreateOrderResponse {
  code: number;
  msg: string;
  data: {
    payment_request_id: string;
    payment_url: string;
    multi_pay: boolean;
  };
}

export interface HspPaymentRecord {
  payment_request_id: string;
  request_id: string;
  token_address: string;
  flow_id: string;
  app_key: string;
  amount: string;
  usd_amount: string;
  token: string;
  chain: string;
  network: string;
  extra_protocol?: string;
  status: HspPaymentStatus;
  status_reason?: string;
  payer_address: string;
  to_pay_address: string;
  risk_level?: string;
  tx_signature?: string;
  broadcast_at?: string;
  gas_limit?: number;
  gas_fee?: string;
  gas_fee_amount?: string;
  service_fee_rate?: string;
  service_fee_type?: string;
  deadline_time?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface HspQueryPaymentsResponse {
  code: number;
  msg: string;
  data: HspPaymentRecord[] | HspPaymentRecord;
}

export interface HspWebhookPayload {
  event_type: 'payment';
  payment_request_id: string;
  request_id: string;
  cart_mandate_id: string;
  payer_address: string;
  amount: string;
  token: string;
  token_address: string;
  chain: string;
  network: string;
  status: 'payment-successful' | 'payment-failed' | 'payment-included';
  created_at: string;
  tx_signature?: string;
  completed_at?: string;
  status_reason?: string;
}

export interface HspJwtClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  cart_hash: string;
}

// ---------------------------------------------------------------------------
// Canonical JSON (RFC 8785)
// ---------------------------------------------------------------------------

function sortKeysRecursive(val: unknown): unknown {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(sortKeysRecursive);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(val as Record<string, unknown>).sort()) {
    sorted[key] = sortKeysRecursive((val as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeysRecursive(obj));
}

// ---------------------------------------------------------------------------
// Crypto helpers (Web Crypto API)
// ---------------------------------------------------------------------------

async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(new Uint8Array(signed));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function base64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// ES256K JWT signing (secp256k1 + SHA-256)
// Note: Requires @noble/curves and @noble/hashes for ES256K signing.
// In server-side contexts (API routes), import these dynamically.
// ---------------------------------------------------------------------------

export async function signEs256kJwt(claims: HspJwtClaims, privateKeyHex: string): Promise<string> {
  const { secp256k1 } = await import('@noble/curves/secp256k1');
  const { sha256 } = await import('@noble/hashes/sha256');

  const header = { alg: 'ES256K', typ: 'JWT' };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;

  const msgHash = sha256(new TextEncoder().encode(signingInput));
  const privKeyBytes = hexToBytes(privateKeyHex);
  const sig = secp256k1.sign(msgHash, privKeyBytes);

  const rBytes = sig.r.toString(16).padStart(64, '0');
  const sBytes = sig.s.toString(16).padStart(64, '0');
  const sigBytes = hexToBytes(rBytes + sBytes);

  return `${headerB64}.${payloadB64}.${base64urlEncode(sigBytes)}`;
}

export async function signMerchantAuthorization(
  contents: HspCartMandateContents,
  merchantName: string,
  privateKeyHex: string,
  expiresInSec = 3600,
): Promise<string> {
  const cartHash = await sha256Hex(canonicalJson(contents));
  const now = Math.floor(Date.now() / 1000);
  const jti = `JWT-${now}-${generateNonce().slice(0, 16)}`;

  const claims: HspJwtClaims = {
    iss: merchantName,
    sub: merchantName,
    aud: 'HashkeyMerchant',
    iat: now,
    exp: now + expiresInSec,
    jti,
    cart_hash: cartHash,
  };

  return signEs256kJwt(claims, privateKeyHex);
}

// ---------------------------------------------------------------------------
// HSP Client
// ---------------------------------------------------------------------------

export class HspClient {
  private appKey: string;
  private appSecret: string;
  private baseUrl: string;
  private timeoutMs: number;
  private merchantPrivateKeyHex?: string;
  private merchantName: string;

  constructor(config: HspClientConfig) {
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.baseUrl = config.baseUrl ?? HSP_BASE_URLS[config.environment ?? 'qa'];
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.merchantPrivateKeyHex = config.merchantPrivateKeyHex;
    this.merchantName = config.merchantName ?? 'SafeFlow Agent';
  }

  async createOrder(request: HspCreateOrderRequest): Promise<HspCreateOrderResponse> {
    return this.signedRequest<HspCreateOrderResponse>(
      'POST',
      '/api/v1/merchant/orders',
      request,
    );
  }

  async createReusableOrder(request: HspCreateOrderRequest): Promise<HspCreateOrderResponse> {
    return this.signedRequest<HspCreateOrderResponse>(
      'POST',
      '/api/v1/merchant/orders/reusable',
      request,
    );
  }

  async createSimpleOrder(params: {
    orderId: string;
    payTo: string;
    amount: string;
    currency?: string;
    coin?: string;
    network?: string;
    chainId?: number;
    contractAddress?: string;
    merchantName?: string;
    cartExpiry?: string;
    displayItems?: HspDisplayItem[];
    redirectUrl?: string;
  }): Promise<HspCreateOrderResponse> {
    const contents = HspClient.buildCartMandateContents(params);

    if (!this.merchantPrivateKeyHex) {
      throw new Error(
        'merchantPrivateKeyHex is required for signing merchant_authorization JWT.',
      );
    }

    const jwt = await signMerchantAuthorization(
      contents,
      params.merchantName ?? this.merchantName,
      this.merchantPrivateKeyHex,
    );

    return this.createOrder({
      cart_mandate: { contents, merchant_authorization: jwt },
      redirect_url: params.redirectUrl,
    });
  }

  async queryPayments(
    params: { cart_mandate_id?: string; payment_request_id?: string; flow_id?: string },
  ): Promise<HspQueryPaymentsResponse> {
    const qs = new URLSearchParams();
    if (params.cart_mandate_id) qs.set('cart_mandate_id', params.cart_mandate_id);
    if (params.payment_request_id) qs.set('payment_request_id', params.payment_request_id);
    if (params.flow_id) qs.set('flow_id', params.flow_id);
    return this.signedRequest<HspQueryPaymentsResponse>(
      'GET',
      '/api/v1/merchant/payments',
      undefined,
      qs.toString(),
    );
  }

  async verifyWebhookSignature(
    signatureHeader: string,
    rawBody: string,
  ): Promise<{ valid: boolean; timestamp: number }> {
    let timestamp = 0;
    let receivedSig = '';
    for (const part of signatureHeader.split(',')) {
      if (part.startsWith('t=')) timestamp = parseInt(part.slice(2), 10);
      else if (part.startsWith('v1=')) receivedSig = part.slice(3);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > 300) {
      return { valid: false, timestamp };
    }

    const message = `${timestamp}.${rawBody}`;
    const expected = await hmacSha256Hex(this.appSecret, message);
    return { valid: expected === receivedSig, timestamp };
  }

  static buildCartMandateContents(params: {
    orderId: string;
    payTo: string;
    amount: string;
    currency?: string;
    coin?: string;
    network?: string;
    chainId?: number;
    contractAddress?: string;
    merchantName?: string;
    cartExpiry?: string;
    displayItems?: HspDisplayItem[];
  }): HspCartMandateContents {
    const coin = params.coin ?? 'USDC';
    const tokenInfo = params.network?.includes('testnet')
      ? HSP_TESTNET_TOKENS[coin as keyof typeof HSP_TESTNET_TOKENS]
      : HSP_MAINNET_TOKENS[coin as keyof typeof HSP_MAINNET_TOKENS];

    const network = params.network ?? tokenInfo?.network ?? 'hashkey-testnet';
    const chainId = params.chainId ?? tokenInfo?.chain_id ?? 133;
    const contractAddress = params.contractAddress ?? tokenInfo?.contract_address ?? '';
    const defaultExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    return {
      id: params.orderId,
      user_cart_confirmation_required: true,
      payment_request: {
        method_data: [{
          supported_methods: 'https://www.x402.org/',
          data: {
            x402Version: 2,
            network,
            chain_id: chainId,
            contract_address: contractAddress,
            pay_to: params.payTo,
            coin,
          },
        }],
        details: {
          id: `PAY-REQ-${params.orderId}`,
          display_items: params.displayItems,
          total: {
            label: 'Total',
            amount: { currency: params.currency ?? 'USD', value: params.amount },
          },
        },
      },
      cart_expiry: params.cartExpiry ?? defaultExpiry,
      merchant_name: params.merchantName ?? 'SafeFlow Agent',
    };
  }

  static async computeCartHash(contents: HspCartMandateContents): Promise<string> {
    return sha256Hex(canonicalJson(contents));
  }

  // -----------------------------------------------------------------------
  // HMAC-signed request (internal)
  // -----------------------------------------------------------------------

  private async signedRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    queryString?: string,
  ): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = generateNonce();

    let bodyHash = '';
    let bodyStr: string | undefined;
    if (body !== undefined) {
      bodyStr = canonicalJson(body);
      bodyHash = await sha256Hex(bodyStr);
    }

    const message = [method, path, queryString ?? '', bodyHash, timestamp, nonce].join('\n');
    const signature = await hmacSha256Hex(this.appSecret, message);

    const url = queryString
      ? `${this.baseUrl}${path}?${queryString}`
      : `${this.baseUrl}${path}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-App-Key': this.appKey,
          'X-Signature': signature,
          'X-Timestamp': timestamp,
          'X-Nonce': nonce,
        },
        body: bodyStr,
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`HSP API returned non-JSON: ${text.slice(0, 200)}`);
      }

      if (!response.ok) {
        const msg = isRecord(parsed) && typeof parsed.msg === 'string'
          ? parsed.msg
          : `${response.status} ${response.statusText}`;
        const code = isRecord(parsed) && typeof parsed.code === 'number'
          ? parsed.code
          : response.status;
        throw new HspApiError(msg, code, response.status);
      }

      return parsed as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class HspApiError extends Error {
  public readonly hspCode: number;
  public readonly httpStatus: number;

  constructor(message: string, hspCode: number, httpStatus: number) {
    super(`HSP API Error [${hspCode}]: ${message}`);
    this.name = 'HspApiError';
    this.hspCode = hspCode;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isTerminalStatus(status: HspPaymentStatus): boolean {
  return status === 'payment-successful' || status === 'payment-failed';
}

export function formatTokenAmount(amount: string, decimals: number): string {
  const raw = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}

export function parseTokenAmount(display: string, decimals: number): string {
  const parts = display.split('.');
  const whole = parts[0] ?? '0';
  const frac = (parts[1] ?? '').padEnd(decimals, '0').slice(0, decimals);
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac)).toString();
}
