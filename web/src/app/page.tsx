'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { AlertTriangle, BarChart3, Globe2, MessageSquare, Settings, Shield, TrendingUp } from 'lucide-react';
import VaultExplorer from '@/components/VaultExplorer';
import ChatAgent from '@/components/ChatAgent';
import DepositModal from '@/components/DepositModal';
import Portfolio from '@/components/Portfolio';
import SessionManager from '@/components/SessionManager';
import ThemeToggle from '@/components/ThemeToggle';
import LangToggle from '@/components/LangToggle';
import { useTranslation } from '@/i18n';
import { getAppRuntimeMode } from '@/lib/chains';
import { useSafeFlowResources } from '@/lib/safeflow-resources';
import type { EarnVault } from '@/types';

type Tab = 'chat' | 'explore' | 'portfolio' | 'settings';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [selectedVault, setSelectedVault] = useState<EarnVault | null>(null);
  const { t } = useTranslation();
  const { isConnected } = useAccount();
  const { currentWallets, currentAgentCaps } = useSafeFlowResources();
  const runtimeMode = getAppRuntimeMode();
  const needsWalletSetup = isConnected && currentWallets.length === 0;
  const needsCapSetup = isConnected && currentWallets.length > 0 && currentAgentCaps.length === 0;
  const showSetupBanner = activeTab !== 'settings' && (needsWalletSetup || needsCapSetup);

  const handleSelectVault = (vault: EarnVault) => {
    setSelectedVault(vault);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'chat', label: t('nav.aiAgent'), icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'explore', label: t('nav.explore'), icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'portfolio', label: t('nav.portfolio'), icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'settings', label: t('nav.settings'), icon: <Settings className="w-4 h-4" /> },
  ];
  const runtimeBadgeTitle = runtimeMode.isLocalFork
    ? t('runtime.badgeTooltipLocal', {
        executionChain: runtimeMode.executionChainName,
        sourceChain: runtimeMode.sourceChainName,
        rpcHost: runtimeMode.rpcHostLabel || t('common.na'),
      })
    : t('runtime.badgeTooltipBase', {
        executionChain: runtimeMode.executionChainName,
        sourceChain: runtimeMode.sourceChainName,
      });
  const runtimeBadgeLabel = runtimeMode.isLocalFork ? t('runtime.localBadge') : t('runtime.baseBadge');
  const runtimeFooterLabel = runtimeMode.isLocalFork ? t('runtime.footerLocal') : t('runtime.footerBase');

  return (
    <div className="min-h-screen flex flex-col relative z-1">
      {/* Header */}
      <header className="glass header-accent sticky top-0 z-50 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-primary/20">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div className="leading-tight">
                <h1 className="text-base font-bold tracking-tight">{t('app.title')}</h1>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">{t('app.subtitle')}</p>
              </div>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden sm:flex items-center gap-0.5 bg-secondary/60 rounded-lg p-0.5">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>

            {/* Right controls */}
            <div className="flex items-center gap-1.5">
              <div
                title={runtimeBadgeTitle}
                className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase backdrop-blur-md ${
                  runtimeMode.isLocalFork
                    ? 'border-amber-500/50 bg-amber-50 text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-300'
                    : 'border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                }`}
              >
                {runtimeMode.isLocalFork ? <AlertTriangle className="w-3.5 h-3.5" /> : <Globe2 className="w-3.5 h-3.5" />}
                <span>{runtimeBadgeLabel}</span>
              </div>
              <LangToggle />
              <ThemeToggle />
              <ConnectButton.Custom>
                {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
                  const connected = mounted && account && chain;
                  return (
                    <div>
                      {!connected ? (
                        <button
                          onClick={openConnectModal}
                          className="ml-1 px-3.5 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
                        >
                          {t('nav.connectWallet')}
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={openChainModal}
                            className="px-2 py-1 bg-secondary rounded-md text-[11px] font-medium hover:bg-secondary/80 transition-colors"
                          >
                            {chain.name}
                          </button>
                          <button
                            onClick={openAccountModal}
                            className="px-2.5 py-1 bg-secondary rounded-md text-[11px] font-mono font-medium hover:bg-secondary/80 transition-colors"
                          >
                            {account.displayName}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }}
              </ConnectButton.Custom>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="sm:hidden flex border-b border-border glass">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-primary'
                : 'text-muted-foreground'
            }`}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <div className="w-4 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 relative z-1">
        {showSetupBanner && (
          <div className="mb-5 rounded-[1.75rem] border border-border bg-card/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] glow-border">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                  {t('app.setupEyebrow')}
                </div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {needsWalletSetup ? t('app.setupWalletTitle') : t('app.setupCapTitle')}
                </h2>
                <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
                  {needsWalletSetup ? t('app.setupWalletDescription') : t('app.setupCapDescription')}
                </p>
              </div>
              <button
                onClick={() => setActiveTab('settings')}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:translate-y-[1px]"
              >
                {t('app.openSettingsCta')}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="max-w-4xl mx-auto w-full animate-fade-in-up">
            <ChatAgent onSelectVault={handleSelectVault} />
          </div>
        )}

        {activeTab === 'explore' && (
          <div className="space-y-5 animate-fade-in-up">
            <div>
              <h2 className="text-xl font-bold">{t('explore.title')}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('explore.subtitle')}
              </p>
            </div>
            <VaultExplorer onSelectVault={handleSelectVault} />
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div className="space-y-5 animate-fade-in-up">
            <div>
              <h2 className="text-xl font-bold">{t('portfolio.title')}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('portfolio.subtitle')}
              </p>
            </div>
            <Portfolio onOpenExplore={() => setActiveTab('explore')} onOpenSettings={() => setActiveTab('settings')} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-5 animate-fade-in-up">
            <div>
              <h2 className="text-xl font-bold">{t('settings.title')}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('settings.subtitle')}
              </p>
            </div>
            <SessionManager />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-3 mt-auto relative z-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-1.5 text-[11px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
          <span>{t('footer.left')}</span>
          <span
            title={runtimeBadgeTitle}
            className={runtimeMode.isLocalFork ? 'text-amber-600 dark:text-amber-300/90' : 'text-emerald-600 dark:text-emerald-300/90'}
          >
            {runtimeFooterLabel}
          </span>
          <span>{t('footer.right')}</span>
        </div>
      </footer>

      {/* Deposit Modal */}
      {selectedVault && (
        <DepositModal
          vault={selectedVault}
          onClose={() => setSelectedVault(null)}
          onOpenSettings={() => setActiveTab('settings')}
        />
      )}
    </div>
  );
}
