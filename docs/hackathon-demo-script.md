# SafeFlow Hackathon Demo Script

> 目标时长：**5–6 分钟**（可压缩到 3 分钟快版 / 扩展到 8 分钟深度版）
> 形式：**Live Demo + 讲解穿插**，一边操作一边解释设计
> 主讲人视角：第一人称 "我们"

---

## 0. 开场（15 秒）

> 大家好，我们是 **SafeFlow**，一个跑在 **HashKey Chain** 上的 **AI 支付代理协议**。
>
> 一句话：**让 AI Agent 帮你付款，但拿不走你的钱。**
>
> 今天我会用 5 分钟，现场跑一遍完整流程，顺便讲清楚我们的设计。

**切屏**：打开浏览器 → 本地 `http://localhost:3000`（已连钱包到 HashKey Fork Local / Testnet 133，顶部导航默认落在 **AI Agent** tab）

---

## 1. 我们要解决的问题（30 秒）

> 现在所有"AI 支付"方案都绕不开一个死结：
>
> - **把私钥交给 Agent** → 一次 prompt injection 就能清空钱包
> - **每次都人工签名** → 那还要 Agent 干嘛
>
> SafeFlow 的答案是第三条路：**Air-Gap 钱包 + 链上能力封装（SessionCap）**。
>
> Agent 永远拿不到 master key，它只拿到一张**链上"信用卡"**——有额度、有频率、有过期时间、可随时吊销。

**讲解点（设计 #1）**：这不是链下签名的"白名单"——是 **Solidity 合约里 require 出来的硬约束**。Agent 想越权，EVM 直接 revert。

---

## 2. 三层架构速览（30 秒，看一眼图就过）

**切到** `@/Users/wang/workspace/hackers/safeflow-hashkey/README.md` 的架构图 / 或 `docs/hashkey-architecture.md`。

> 从上到下三层：
>
> 1. **用户层**：Chat 自然语言 → `action: hsp_pay` 结构化指令
> 2. **协调层**：本地构造 **HSP Cart Mandate**，计算 `cart_hash`（canonical-JSON SHA-256），可选 ES256K 签商户 JWT —— 我们集成的是 HashKey 官方商户结算协议，不是 mock
> 3. **执行层**：`SafeFlowVaultHashKey.executePayment()` —— SessionCap 约束的支付入口，**`cart_hash` 作为 `reasonHash` 钉在链上事件里**
>
> **一句话带过**：AI 说话，HSP 定意图，SafeFlow 上链 —— 每一环都可审计。

---

## 3. Demo Part 1 — Create Vault + 注资（45 秒）

**操作**：进 **Vault** tab → **Create Vault** → 再 **Deposit 1 HSK**。

> 第一步，我在 HashKey 链上建一个 **SafeFlowVault** 并存入 1 枚原生 HSK。
>
> 这不是 EOA，是 `SafeFlowVaultHashKey` 合约里的一个 **vaultId = 0**——资金和权限完全隔离，只有 owner（我）能 `withdraw`。

**两次 MetaMask 确认 → 链上 ✅**

**讲解点（设计 #2 — Fund Isolation）**：

- 合约文件：`@/Users/wang/workspace/hackers/safeflow-hashkey/contracts/src/SafeFlowVaultHashKey.sol`
- 关键约束：`withdraw()` 用 `onlyVaultOwner(vaultId)` 修饰器强制检查 `msg.sender == vault.owner`
- Agent 永远不是 owner，所以**任何执行路径都不可能把钱转回 Agent 自己**

---

## 4. Demo Part 2 — 授权 Agent：SessionCap（60 秒）

**操作**：进 **Sessions** tab → **Grant Session** 表单

| 字段 | 填什么 | 为什么 |
|---|---|---|
| Vault ID | 刚建的 #0 | 绑定到哪个 vault |
| Agent Address | 粘贴当前连接钱包地址 | 单钱包 demo 拓扑：我既是 owner 也是 agent |
| Max Per Second | `0.01 HSK/s`（`10^16` wei/s） | **速率护栏**（`maxSpendPerSec × elapsed ≥ amount`） |
| Max Total | `0.5 HSK`（`5×10^17` wei） | **总额度** |
| Expires At | `now + 2h` | 过期自动失效 |

**点击 Grant Session → 签名 → 链上 ✅**

**讲解点（设计 #3 — Bounded Execution）**：

> 这就是我们整个安全模型的核心。
>
> Agent 拿到的不是"无限授权"，是一张**带过期的预付卡**：
>
> - **per-interval cap** → 防止一次被 prompt 掏空
> - **total cap** → 最坏情况的损失上限
> - **expiry** → 即使我忘了吊销，它自己会死
> - **revoke()** → 人类随时一键失效（kill switch）
>
> 这四个维度的组合，就是我们说的 **"Air-Gap"**：Agent 和主钱包之间隔着一道**链上验证的气墙**。

**展示代码（一闪而过）**：`@/Users/wang/workspace/hackers/safeflow-hashkey/contracts/src/SafeFlowVaultHashKey.sol:215-224` —— `executePayment()` 的四道关卡：

```solidity
if (block.timestamp > cap.expiresAtSec)              revert SessionExpired();
if (cap.totalSpent + amount > cap.maxSpendTotal)     revert ExceedsTotalLimit();
uint256 allowedSpend = (block.timestamp - cap.lastSpendTimeSec) * cap.maxSpendPerSecond;
if (amount > allowedSpend)                           revert ExceedsRateLimit();
if (vaults[vaultId].balance < amount)                revert InsufficientBalance();
```

> 四个 custom error，决定了这个 Agent 的一生。

---

## 5. Demo Part 3 — Chat 驱动的 HSP × SafeFlow 支付（120 秒 · 主菜）

**切到** **AI Agent** tab（HashKey 模式顶部第一个 tab）。

**输入**（或直接点预设的 quick prompt）：
> `Pay 0.05 HSK to 0x000000000000000000000000000000000000dEaD for the HSP demo`

中文也能识别：
> `付 0.05 HSK 给 0x000000000000000000000000000000000000dEaD 作为商户结算`

**气泡里立刻生长出一张 `HspPayActionCard` —— 三步卡片会逐步点亮：**

### Step 1 — Build HSP Cart Mandate（自动运行）

- 前端 POST `/api/hashkey/hsp-demo/prepare`
- 后端本地构造 **HSP Cart Mandate contents**（order_id / pay_to / amount / coin=HSK / chain_id=133 / displayItems）
- 用 **RFC 8785 canonical JSON + SHA-256** 计算 **`cart_hash`**
- 如果 `.env` 有 `HSP_MERCHANT_PRIVATE_KEY` → 用 **ES256K (secp256k1)** 签一份 `merchant_authorization` JWT
- UI 显示：`cart_hash`（可点复制）、`order_id`、JWT 状态，可展开完整 cart JSON

**讲解点（设计 #4 — HSP Native Integration）**：

> HashKey 生态的真商户结算走 **HSP（HashKey Settlement Protocol）**——管法币出入金、合规、对账。
>
> 我们没有发一个裸的 `transfer()`，而是把 AI 的自然语言**翻译成 HSP Cart Mandate**，用 **canonical JSON + SHA-256** 得到一个权威的 `cart_hash`——这是整个生态公认的订单指纹。
>
> 关键代码：`@/Users/wang/workspace/hackers/safeflow-hashkey/web/src/lib/hsp/client.ts` + `@/Users/wang/workspace/hackers/safeflow-hashkey/web/src/app/api/hashkey/hsp-demo/prepare/route.ts`

### Step 2 — Pin cart_hash on-chain via SessionCap

**操作**：点 **Execute via SafeFlow** 按钮 → 钱包弹签名。

调用参数（观众能在 MetaMask 里看到）：

```text
SafeFlowVaultHashKey.executePayment(
  vaultId    = 0,
  recipient  = 0x...dEaD,
  amount     = 50_000_000_000_000_000,       // 0.05 HSK
  reasonHash = <HSP cart_hash>,              // ← 就是 Step 1 算出来的那串
  reasonMemo = "HSP demo"
)
```

**讲解点（设计 #5 — Evidence Binding）**：

> 这是整场 demo 最关键的一行：**我们把 HSP 的 `cart_hash` 原封不动当作 SafeFlow 合约的 `reasonHash` 写进去**。
>
> 合约会 emit `PaymentExecuted(vaultId, agent, recipient, amount, reasonHash, reasonMemo)`——事后任何审计方拿到这条 tx，可以：
>
> 1. 把 `reasonHash` 和 HSP 那边归档的 cart JSON 做 canonical-JSON + SHA-256，哈希必须一致
> 2. 如果 merchant JWT 已签，还能用 secp256k1 公钥验证这个订单是商户亲手授权的
>
> **HSP 的意图 ⟷ SafeFlow 的执行，用同一个哈希钉死。**

### Step 3 — Evidence bound + PaymentHistory

- Tx 上链成功 → 卡片绿色条：「The HSP `cart_hash` is now stored as `reasonHash` in the `PaymentExecuted` event」
- 同时卡片自动走完 **intent 生命周期**（create → ACK → result），切到 **History** tab 这笔立刻显示为 **Executed**，带 tx 链接

> 整个过程：**自然语言 → HSP 订单 → 链上 SessionCap 放行 → 审计可重放**，一气呵成。

---

## 6. Demo Part 4 — 越权尝试（30 秒 · 戏剧性环节）

**操作**：在同一个 chat 里再追一句：
> `Pay 10 HSK to 0x000000000000000000000000000000000000dEaD for takeover test`

（10 HSK 远超我们设的 0.5 HSK total cap）

**预期结果**：

- LLM / 规则解析器照单生成了 `action: hsp_pay`（**LLM 不可信！**）
- Step 1 Cart Mandate 也照样签出来了（HSP 层不管额度）
- 点 Execute → Step 2 直接触发 revert，卡片变红：
  - `ExceedsTotalLimit` 或 `ExceedsRateLimit` custom error
  - 原生 revert reason 在卡片底部原文展示

**讲解点**：

> 注意 LLM、Agent、HSP 这三层**都没有阻止这次攻击**——只有最底层的合约 `if (...) revert ExceedsTotalLimit();` 挡住了。
>
> **上面随便被攻破，最坏损失 = SessionCap 的剩余额度**，不会超过。

---

## 7. Demo Part 5 — Kill Switch（15 秒）

**操作**：Sessions tab → **Revoke** → 签名

> 如果我觉得 Agent 行为不对，一键 revoke。回到 chat 再发一笔支付，卡片会在 Step 2 直接 `SessionNotFound` revert。
>
> **人类永远在环路的最顶端。**

---

## 8. 技术亮点收尾（45 秒）

一页 slide 或口述：

> **SafeFlow 在这次 hackathon 里做到了：**
>
> 1. **链上核心** —— `SafeFlowVaultHashKey.sol` + Foundry 全覆盖测试
>    - 位置：`@/Users/wang/workspace/hackers/safeflow-hashkey/contracts/test/SafeFlowVaultHashKey.t.sol`
> 2. **本地 HashKey Fork** —— 一键起 fork + 部署 + 配置 web，3 秒开发循环
>    - 位置：`@/Users/wang/workspace/hackers/safeflow-hashkey/scripts/start-hashkey-fork.sh`
> 3. **HSP × SafeFlow 哈希锚定** —— canonical-JSON SHA-256 `cart_hash` 直接作为链上 `reasonHash`，不是 mock
>    - 位置：`@/Users/wang/workspace/hackers/safeflow-hashkey/web/src/lib/hsp/client.ts` + `@/Users/wang/workspace/hackers/safeflow-hashkey/web/src/app/api/hashkey/hsp-demo/prepare/route.ts`
> 4. **Chat-driven AI Agent** —— LLM tool_call + 规则兜底，支持中英双语 `付/pay/send X HSK to 0x...` 识别
>    - 位置：`@/Users/wang/workspace/hackers/safeflow-hashkey/web/src/components/HspPayActionCard.tsx`
> 5. **多语言 UI + HashKey 品牌化** —— 中英双语，深浅色主题

---

## 9. 一句话总结（10 秒）

> **SafeFlow = AI 的速度 + 合约的刹车 + HashKey 的结算。**
>
> 让 Agent 能付款，让用户能睡觉。
>
> 谢谢！

---

# 附：快版 3 分钟 Demo

压缩到：

1. 开场问题（15s）
2. Create Vault + Grant Session 一气呵成（50s，讲设计 #2 + #3）
3. Chat 输入 `pay 0.05 HSK to 0x...` → 三步卡片自动点亮（90s，讲设计 #4 + #5 —— 主要停留在 `cart_hash == reasonHash` 那一刻）
4. 越权 revert 演示（15s）
5. 收尾（10s）

# 附：扩展 8 分钟深度版

加入：

- `docs/hashkey-hsp-research.md` 里 HSP 协议细节 1 分钟
- `@/Users/wang/workspace/hackers/safeflow-hashkey/contracts/src/SafeFlowVaultHashKey.sol` 代码走读 1 分钟
- Foundry 测试用例跑一遍（`forge test -vv`）30 秒

---

# 演示前 Checklist

> **彩排必备，避免现场翻车**

- [ ] `./scripts/start-hashkey-fork.sh` 已起，chain 31338 可连
- [ ] `web/.env` 的 `NEXT_PUBLIC_HASHKEY_CONTRACT` 指向 fork 上的最新部署
- [ ] `web/.env` 已设 `NEXT_PUBLIC_HASHKEY_ENABLED=true`（确保顶部导航进入 HashKey 模式）
- [ ] （可选）`HSP_MERCHANT_PRIVATE_KEY` 已设，Step 1 JWT 状态会显示绿色 `ES256K signed`
- [ ] MetaMask 已添加 HashKey Fork Local (31338) 或 Testnet (133)
- [ ] 主钱包有 HSK 余额（fork 里可用 anvil impersonate 刷）
- [ ] 已预先 **Create Vault → Deposit 1 HSK → Grant Session（self-agent）**，或留给现场演示
- [ ] Anthropic / OpenAI API key 有效（可选，规则兜底也能识别 `pay X HSK to 0x...`）
- [ ] 浏览器 zoom 125% + 隐藏书签栏，方便录屏
- [ ] 预先点开所有要展示的文件 tab（`SafeFlowVaultHashKey.sol`、`hsp/client.ts`、`HspPayActionCard.tsx`、`hsp-demo/prepare/route.ts`）
- [ ] 预先复制一个 **故意超限** 的 prompt 到剪贴板（例如 `pay 10 HSK to 0x...dEaD`），Part 4 一秒贴上去
