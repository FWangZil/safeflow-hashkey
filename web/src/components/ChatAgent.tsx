'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { Send, Bot, User, Sparkles, Loader2, ArrowRight, Zap, TrendingUp, Shield, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, EarnVault, RecallActionData } from '@/types';
import { formatApy, formatTvl } from '@/lib/earn-api';
import { useTranslation } from '@/i18n';
import { useSafeFlowResources } from '@/lib/safeflow-resources';
import RecallActionCard from '@/components/RecallActionCard';

interface ChatAgentProps {
  onSelectVault?: (vault: EarnVault) => void;
  onOpenSettings?: () => void;
  initialMessage?: string;
  initialRecallData?: RecallActionData;
  onInitialMessageConsumed?: () => void;
}

export default function ChatAgent({ onSelectVault, onOpenSettings, initialMessage, initialRecallData, onInitialMessageConsumed }: ChatAgentProps) {
  const { t } = useTranslation();
  const { isConnected } = useAccount();
  const { currentWallets, currentAgentCaps, isHydrated } = useSafeFlowResources();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const needsWalletSetup = isConnected && isHydrated && currentWallets.length === 0;
  const needsCapSetup = isConnected && isHydrated && currentWallets.length > 0 && currentAgentCaps.length === 0;
  const showSetupCard = needsWalletSetup || needsCapSetup;
  const showReadyCard = isConnected && isHydrated && !needsWalletSetup && !needsCapSetup;

  const QUICK_PROMPTS = [
    { icon: <TrendingUp className="w-4 h-4" />, text: t('chat.quickPrompts.stablecoin') },
    { icon: <Zap className="w-4 h-4" />, text: t('chat.quickPrompts.eth') },
    { icon: <Shield className="w-4 h-4" />, text: t('chat.quickPrompts.safe') },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-send when triggered from Portfolio "Ask AI to Recall"
  const lastInitialMessage = useRef<string>('');
  const pendingRecallRef = useRef<RecallActionData | undefined>();
  useEffect(() => {
    if (!initialMessage || initialMessage === lastInitialMessage.current) return;
    lastInitialMessage.current = initialMessage;
    onInitialMessageConsumed?.();
    // Store recall data — will be attached to the assistant reply, not injected immediately
    pendingRecallRef.current = initialRecallData;
    sendMessage(initialMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, initialRecallData]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const MAX_RETRIES = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
      try {
        const res = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text.trim(), history: messages.slice(-10) }),
        });

        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json() as Pick<ChatMessage, 'content' | 'vaults' | 'action'> & { message: string };

        // Consume pending recall data and attach it to this assistant message
        const recallData = pendingRecallRef.current;
        pendingRecallRef.current = undefined;

        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.message,
          timestamp: Date.now(),
          vaults: data.vaults,
          action: recallData
            ? { type: 'recall', recallData }
            : data.action,
        };
        setMessages(prev => [...prev, assistantMsg]);
        setIsLoading(false);
        inputRef.current?.focus();
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(t('chat.errorRetry'));
      }
    }

    const errorMsg: ChatMessage = {
      id: `error-${Date.now()}`,
      role: 'assistant',
      content: `${t('chat.errorPrefix')} ${lastError?.message ?? t('chat.errorRetry')}`,
      timestamp: Date.now(),
      retryText: text.trim(),
      retryUserMsgId: userMsg.id,
    };
    setMessages(prev => [...prev, errorMsg]);
    setIsLoading(false);
    inputRef.current?.focus();
  }, [isLoading, messages, t]);

  const handleSend = () => sendMessage(input);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] border border-border rounded-2xl bg-card/60 overflow-hidden glow-border">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border glass">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-primary/10 flex items-center justify-center">
          <Bot className="w-4.5 h-4.5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">{t('chat.headerTitle')}</div>
          <div className="text-[11px] text-muted-foreground font-data">{t('chat.headerSubtitle')}</div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 border border-success/20">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="text-[11px] text-success font-semibold">{t('chat.online')}</span>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          /* Welcome state */
          <div className="flex flex-col items-center justify-center h-full px-6 py-10">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-primary/10 flex items-center justify-center mb-5">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-bold mb-1">{t('chat.welcomeTitle')}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-xl mb-6 leading-relaxed text-balance">
              {t('chat.welcomeSubtitle')}
            </p>

            {showSetupCard && (
              <div className="w-full max-w-3xl rounded-[1.6rem] border border-amber-400/30 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-400/20 p-4 mb-6 shadow-[0_20px_60px_-36px_rgba(245,158,11,0.35)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1.5">
                    <div className="inline-flex w-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] shadow-sm border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-background/80 dark:text-amber-400 dark:border-amber-500/25">
                      {t('chat.setupEyebrow')}
                    </div>
                    <div className="text-[15px] font-semibold tracking-tight text-foreground">
                      {needsWalletSetup
                        ? t('chat.setupWalletTitle')
                        : needsCapSetup
                          ? t('chat.setupCapTitle')
                          : t('chat.setupReadyTitle')}
                    </div>
                    <p className="max-w-[64ch] text-[13px] leading-relaxed text-foreground/80">
                      {needsWalletSetup
                        ? t('chat.setupWalletDescription')
                        : needsCapSetup
                          ? t('chat.setupCapDescription')
                          : t('chat.setupReadyDescription')}
                    </p>
                  </div>
                  {showSetupCard && onOpenSettings && (
                    <button
                      onClick={onOpenSettings}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:translate-y-[1px]"
                    >
                      {t('chat.openSettingsCta')}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="w-full max-w-3xl space-y-2.5">
              {QUICK_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(prompt.text)}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-border bg-card/60 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 transition-all duration-200 text-left group"
                >
                  <span className="text-muted-foreground group-hover:text-primary transition-colors">
                    {prompt.icon}
                  </span>
                  <span className="flex-1 text-sm font-medium">{prompt.text}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Chat messages */
          <div className="p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-fade-in-up`}>
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    msg.role === 'user'
                      ? 'bg-primary/15'
                      : 'bg-gradient-to-br from-indigo-500/15 to-purple-500/15 border border-primary/10'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <User className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                  )}
                </div>
                <div className={`max-w-[85%] space-y-1.5 ${msg.role === 'user' ? 'items-end' : ''}`}>
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : msg.retryText
                          ? 'bg-destructive/10 border border-destructive/20 rounded-tl-sm'
                          : 'bg-secondary/80 rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
                          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                          code: ({ children }) => <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-[0.85em]">{children}</code>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-primary transition-colors">{children}</a>,
                          h1: ({ children }) => <h1 className="text-base font-bold mb-1.5">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                          table: ({ children }) => (
                            <div className="overflow-x-auto mb-2">
                              <table className="w-full text-xs border-collapse">{children}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="border-b border-white/20">{children}</thead>,
                          tbody: ({ children }) => <tbody>{children}</tbody>,
                          tr: ({ children }) => <tr className="border-b border-white/10 last:border-0">{children}</tr>,
                          th: ({ children }) => <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">{children}</th>,
                          td: ({ children }) => <td className="px-2 py-1.5 font-data">{children}</td>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                    {msg.retryText && (
                      <button
                        onClick={() => {
                          setMessages(prev => prev.filter(m => m.id !== msg.id && m.id !== msg.retryUserMsgId));
                          sendMessage(msg.retryText!);
                        }}
                        disabled={isLoading}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t('chat.retry')}
                      </button>
                    )}
                  </div>

                  {/* Vault cards */}
                  {msg.vaults && msg.vaults.length > 0 && (
                    <div className="grid gap-2 mt-1">
                      {msg.vaults.map((vault, i) => (
                        <div
                          key={`${vault.address}-${i}`}
                          className="p-3.5 rounded-xl border border-border bg-card/80 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 cursor-pointer transition-all duration-200 group"
                          onClick={() => onSelectVault?.(vault)}
                        >
                          <div className="flex justify-between items-start gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                                {vault.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {vault.protocol?.name} · {vault.network}
                              </div>
                              {vault.tags && vault.tags.length > 0 && (
                                <div className="flex gap-1 mt-1.5">
                                  {vault.tags.slice(0, 3).map(tag => (
                                    <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded-md bg-primary/10 text-primary font-semibold">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-sm font-bold text-success font-data">
                                {formatApy(vault.analytics?.apy?.total)}
                              </div>
                              <div className="text-[11px] text-muted-foreground font-data mt-0.5">
                                {formatTvl(vault.analytics?.tvl?.usd)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recall action card */}
                  {msg.action?.type === 'recall' && msg.action.recallData && (
                    <RecallActionCard {...msg.action.recallData} />
                  )}

                  <div className="text-[10px] text-muted-foreground/40 px-1 font-data">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-2.5 animate-fade-in-up">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/15 to-purple-500/15 border border-primary/10 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="bg-secondary/80 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span className="font-data text-xs">{t('chat.analyzing')}</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border glass">
        <div className="flex gap-2 items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={isEmpty ? t('chat.inputPlaceholder') : t('chat.inputFollowUp')}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/30 placeholder:text-muted-foreground/50 disabled:opacity-50 transition-all"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="p-2.5 bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground/40">
          <Shield className="w-3 h-3" />
          <span>{t('chat.sessionCapNote')}</span>
        </div>
      </div>
    </div>
  );
}
