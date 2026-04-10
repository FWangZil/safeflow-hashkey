'use client';

import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Shield, TrendingUp, MessageSquare, BarChart3, Settings, ExternalLink } from 'lucide-react';
import VaultExplorer from '@/components/VaultExplorer';
import ChatAgent from '@/components/ChatAgent';
import type { EarnVault } from '@/types';

type Tab = 'explore' | 'chat' | 'portfolio' | 'settings';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('explore');
  const [selectedVault, setSelectedVault] = useState<EarnVault | null>(null);

  const handleSelectVault = (vault: EarnVault) => {
    setSelectedVault(vault);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'explore', label: 'Explore', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'chat', label: 'AI Agent', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'portfolio', label: 'Portfolio', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
                <Shield className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">SafeFlow</h1>
                <p className="text-xs text-muted-foreground -mt-0.5">Yield Agent</p>
              </div>
            </div>

            <nav className="hidden sm:flex items-center gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-5 h-5" />
              </a>
              <ConnectButton.Custom>
                {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
                  const connected = mounted && account && chain;
                  return (
                    <div>
                      {!connected ? (
                        <button
                          onClick={openConnectModal}
                          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                          Connect Wallet
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={openChainModal}
                            className="px-2.5 py-1.5 bg-secondary rounded-lg text-xs font-medium hover:bg-secondary/80 transition-colors"
                          >
                            {chain.name}
                          </button>
                          <button
                            onClick={openAccountModal}
                            className="px-3 py-1.5 bg-secondary rounded-lg text-xs font-medium hover:bg-secondary/80 transition-colors font-mono"
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
      <div className="sm:hidden flex border-b border-border bg-card/50">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.id ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'explore' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Yield Vaults</h2>
              <p className="text-muted-foreground mt-1">
                Discover and compare yield opportunities across 20+ protocols. Powered by LI.FI Earn API.
              </p>
            </div>
            <VaultExplorer onSelectVault={handleSelectVault} />
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">AI Yield Agent</h2>
              <p className="text-muted-foreground mt-1">
                Tell me your yield strategy in plain English. I&apos;ll find the best vaults and execute deposits securely.
              </p>
            </div>
            <div className="max-w-3xl">
              <ChatAgent onSelectVault={handleSelectVault} />
            </div>
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Portfolio</h2>
              <p className="text-muted-foreground mt-1">
                View your current yield positions and performance.
              </p>
            </div>
            <div className="p-8 border border-border rounded-lg bg-card text-center">
              <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Connect your wallet to view portfolio positions.</p>
              <p className="text-xs text-muted-foreground mt-1">Data from LI.FI Earn Portfolio API</p>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Session Policy</h2>
              <p className="text-muted-foreground mt-1">
                Configure SafeFlow SessionCap parameters for your AI agent.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="p-5 border border-border rounded-lg bg-card space-y-3">
                <h3 className="font-medium">Spending Limits</h3>
                <div className="space-y-2">
                  <label className="block text-sm text-muted-foreground">Max per interval</label>
                  <input
                    type="text"
                    placeholder="1000 USDC"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm text-muted-foreground">Max total</label>
                  <input
                    type="text"
                    placeholder="5000 USDC"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm text-muted-foreground">Interval (seconds)</label>
                  <input
                    type="text"
                    placeholder="3600"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="p-5 border border-border rounded-lg bg-card space-y-3">
                <h3 className="font-medium">Agent Configuration</h3>
                <div className="space-y-2">
                  <label className="block text-sm text-muted-foreground">Agent address</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm text-muted-foreground">Expiry</label>
                  <input
                    type="datetime-local"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <button className="w-full mt-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                  Create SessionCap
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-muted-foreground">
          <span>SafeFlow Yield Agent — DeFi Mullet Hackathon #1 • Track 2: AI × Earn</span>
          <span>Powered by LI.FI Earn API</span>
        </div>
      </footer>

      {/* Vault Detail Modal */}
      {selectedVault && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedVault(null)}>
          <div className="bg-card border border-border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">{selectedVault.name}</h3>
                <p className="text-sm text-muted-foreground">{selectedVault.protocol?.name} • {selectedVault.network}</p>
              </div>
              <button onClick={() => setSelectedVault(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 bg-background rounded-lg">
                <div className="text-xs text-muted-foreground">Total APY</div>
                <div className="text-lg font-bold text-success">{selectedVault.analytics?.apy?.total?.toFixed(2) ?? 'N/A'}%</div>
              </div>
              <div className="p-3 bg-background rounded-lg">
                <div className="text-xs text-muted-foreground">TVL</div>
                <div className="text-lg font-bold">
                  {selectedVault.analytics?.tvl?.usd ? `$${(Number(selectedVault.analytics.tvl.usd) / 1e6).toFixed(2)}M` : 'N/A'}
                </div>
              </div>
              <div className="p-3 bg-background rounded-lg">
                <div className="text-xs text-muted-foreground">Base APY</div>
                <div className="font-medium">{selectedVault.analytics?.apy?.base?.toFixed(2) ?? 'N/A'}%</div>
              </div>
              <div className="p-3 bg-background rounded-lg">
                <div className="text-xs text-muted-foreground">Reward APY</div>
                <div className="font-medium">{selectedVault.analytics?.apy?.reward?.toFixed(2) ?? '0'}%</div>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-xs text-muted-foreground mb-1.5">Tokens</div>
              <div className="flex flex-wrap gap-1.5">
                {selectedVault.underlyingTokens?.map(t => (
                  <span key={t.address} className="px-2 py-1 bg-secondary rounded text-xs font-medium">{t.symbol}</span>
                ))}
              </div>
            </div>

            {selectedVault.tags && selectedVault.tags.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-muted-foreground mb-1.5">Tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedVault.tags.map(tag => (
                    <span key={tag} className="px-2 py-1 bg-primary/10 text-primary rounded text-xs">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            <button className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors">
              Deposit via SafeFlow Agent
            </button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Protected by SessionCap spending limits
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
