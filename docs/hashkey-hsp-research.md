# HSP (HashKey Settlement Protocol) / HP2 Research

> Sources: merchant-docs-all-in-one.pdf, Hashkey_Payment_Deck_CaaS_EN.pdf from hashfans.io

## Overview

HashKey Merchant is a crypto payment gateway for merchants, supporting on-chain stablecoin payments (USDC/USDT). The protocol layer is called **HP2** (HashKey Payment Protocol), part of the broader **CaaS** (Compliance-as-a-Service) offering.

- **RESTful API** based — not a direct on-chain protocol
- **HMAC-SHA256** request signing on every API call
- **ES256K (secp256k1) JWT** for merchant authorization (`merchant_authorization`)
- **x402 protocol** for payment method descriptors
- **Cart Mandate / Payment Mandate** model aligned with AP2 (Agent Payments Protocol) VDCs
- **Webhook** notifications with HMAC-SHA256 verification + up to 6 exponential-backoff retries

---

## Core Concepts

### Cart Mandate (Merchant-side)
The payment order created by the merchant backend:
- `cart_mandate_id` (ID1) — order identifier
- `payment_request_id` (ID2) — payment request id
- `flow_id` (ID3) — checkout flow id (gateway-assigned)
- `merchant_authorization` — ES256K JWT binding cart contents

### Payment Mandate (User-side)
The user's EIP-712 authorization to execute the payment, produced at checkout when they sign with their wallet.

### Order Types
| Type | Endpoint | Use Case |
|------|----------|----------|
| One-time | `POST /merchant/orders` | E-commerce, one-off fees |
| Reusable | `POST /merchant/orders/reusable` | Subscriptions, device rental, vending |

---

## Authentication

### Layer 1: HMAC-SHA256 (every API call)
Required headers: `X-App-Key`, `X-Signature`, `X-Timestamp`, `X-Nonce`

```
message = "{METHOD}\n{PATH}\n{QUERY}\n{bodyHash}\n{timestamp}\n{nonce}"
signature = hex(HMAC-SHA256(app_secret, message))
```

- `bodyHash` = `hex(SHA256(canonicalJSON(requestBody)))` for POST, empty string for GET
- Timestamp skew: ±300 seconds
- Nonce uniqueness within 5-minute window

### Layer 2: ES256K JWT (merchant_authorization)
JWT claims: `iss`, `sub`, `aud="HashkeyMerchant"`, `iat`, `exp`, `jti`, `cart_hash`

`cart_hash` = SHA-256 of Canonical JSON (RFC 8785) of `cart_mandate.contents`

---

## API Reference

### Base URLs
| Environment | URL |
|-------------|-----|
| QA (testnet) | https://merchant-qa.hashkeymerchant.com |
| Staging | https://merchant-stg.hashkeymerchant.com |
| Production | https://merchant.hashkey.com |

Base path: `/api/v1`

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/merchant/orders` | Create one-time payment order |
| POST | `/merchant/orders/reusable` | Create reusable payment order |
| GET | `/merchant/payments` | Query one-time payments |
| GET | `/merchant/payments/reusable` | Query reusable payments |

### Cart Mandate Request Structure
```json
{
  "cart_mandate": {
    "contents": {
      "id": "ORDER-001",
      "user_cart_confirmation_required": true,
      "payment_request": {
        "method_data": [{
          "supported_methods": "https://www.x402.org/",
          "data": {
            "x402Version": 2,
            "network": "hashkey-testnet",
            "chain_id": 133,
            "contract_address": "0x79AEc4EeA31D50792F61D1Ca0733C18c89524C9e",
            "pay_to": "0x...",
            "coin": "USDC"
          }
        }],
        "details": {
          "id": "PAY-REQ-001",
          "display_items": [
            {"label": "Item A", "amount": {"currency": "USD", "value": "10.00"}}
          ],
          "total": {"label": "Total", "amount": {"currency": "USD", "value": "10.00"}}
        }
      },
      "cart_expiry": "2024-03-01T12:00:00Z",
      "merchant_name": "SafeFlow Agent"
    },
    "merchant_authorization": "eyJhbG..."
  },
  "redirect_url": "https://yoursite.com/callback"
}
```

---

## Supported Chains & Tokens

### Testnet
| Network | Chain ID | Token | Contract | Protocol |
|---------|----------|-------|----------|----------|
| Sepolia | 11155111 | USDC | 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 | EIP-3009 |
| Sepolia | 11155111 | USDT | 0xff5588b3b38dff1b4b49bfdcbf985e84d8751a0e | Permit2 |
| Sepolia | 11155111 | HSK | 0x31bdac8e4b897e470b70ebe286f94245baa793c2 | Permit2 |
| HashKey Testnet | 133 | USDC | 0x79AEc4EeA31D50792F61D1Ca0733C18c89524C9e | EIP-3009 |
| HashKey Testnet | 133 | USDT | 0x372325443233fEbaC1F6998aC750276468c83CC6 | Permit2 |

### Mainnet
| Network | Chain ID | Token | Contract | Protocol |
|---------|----------|-------|----------|----------|
| Ethereum | 1 | USDC | 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 | EIP-3009 |
| Ethereum | 1 | USDT | 0xdac17f958d2ee523a2206206994597c13d831ec7 | Permit2 |
| Ethereum | 1 | HSK | 0xe7c6bf469e97eeb0bfb74c8dbff5bd47d4c1c98a | Permit2 |
| HashKey | 177 | USDC | 0x054ed45810DbBAb8B27668922D110669c9D88D0a | EIP-3009 |
| HashKey | 177 | USDT | 0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029 | Permit2 |

---

## Payment State Machine

```
payment-required → payment-submitted → payment-verified → payment-processing
                                                              ↓
                                               payment-included → payment-successful (terminal)
                                                              ↓
                                                       payment-failed (terminal)
```

- `payment-included`: In block, confirmations pending (often sufficient for small amounts)
- `payment-successful`: True terminal success (may take 20-60 min)
- `payment-failed`: True terminal failure

---

## Webhooks

POST to configured `webhook_url` on terminal states.

Signature header: `X-Signature: t=<unix_timestamp>,v1=<hmac_hex>`

```
message   = timestamp + "." + raw_request_body
signature = hex(HMAC-SHA256(app_secret, message))
```

Retry schedule: 1min, 5min, 15min, 1hr, 6hr, 24hr

---

## Merchant Onboarding

1. Generate secp256k1 key pair (ES256K)
2. Submit registration to `hsp_hackathon@hashkey.com`
3. Verify email, bind organization
4. Create application → obtain `app_key` + `app_secret`

---

## HP2 Protocol Features (from Payment Deck)

- **Direct Settlement (Mode A)**: P2P, funds bypass platform, KYT monitoring
- **Two-Tier Settlement (Mode B)**: Platform aggregation, smart contract commission split, licensed custody
- **Core Features**: Mandate (authorization), Receipt (on-chain voucher), On-chain AML & privacy
- **Performance**: < 1% avg fee, ~2 sec settlement finality, thousands of TPS

---

## SafeFlow Integration Points

### How SafeFlow fits with HSP/HP2:
1. **SafeFlow** = Agent authorization + safety guardrails (vault, session cap, rate limit)
2. **HP2/HSP** = Payment routing + settlement layer (merchant API, on-chain execution, compliance)
3. **Integration**: SafeFlow Producer API acts as the "Merchant Backend" in HSP architecture

### Integration Flow:
```
AI Agent → polls Producer API for intents
                ↓
Producer API → creates HSP Cart Mandate via Merchant API
                ↓
HSP Gateway → generates checkout flow / on-chain execution
                ↓
HSP Webhook → notifies Producer API of payment outcome
                ↓
Producer API → updates intent status → Agent confirms
```

### Implementation Tasks:
1. **HSP Client SDK** (`sdk/src/hsp.ts`): HMAC signing, JWT creation, Cart Mandate builder
2. **Producer API HSP routes**: Wrap intent creation with HSP order creation
3. **Webhook receiver**: Handle HSP payment callbacks
4. **Frontend HSP panel**: Show HSP payment status, redirect to checkout URL
