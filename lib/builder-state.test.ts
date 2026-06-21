import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Builder render state', () => {
  it('uses the live oracle state directly for quotes and mintable legs', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain('const oracle = useMemo(');
    expect(source).toContain('oracleQuery.data ?? undefined');
    expect(source).not.toContain('withScenario');
    expect(source).not.toContain('ScenarioSliders');
  });

  it('does not quote or mint against expired oracle state', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain('isLiveOracleState');
    expect(source).toContain("setQuoteSource('Oracle expired')");
    expect(source).toContain('setQuote(undefined)');
  });

  it('does not show an unused max-loss input for capped bull or bear templates', () => {
    const source = readFileSync('app/components/TemplatePicker.tsx', 'utf8');

    expect(source).not.toContain('label="Max Loss $"');
  });

  it('removes unused live-page panels instead of keeping demo-like UI around', () => {
    expect(existsSync('app/components/DrawPayoffCanvas.tsx')).toBe(false);
    expect(existsSync('app/components/ScenarioSliders.tsx')).toBe(false);
    expect(existsSync('app/components/PortfolioPanel.tsx')).toBe(false);
    expect(existsSync('app/components/RfqPanel.tsx')).toBe(false);
    expect(existsSync('app/components/TranchePanel.tsx')).toBe(false);
    expect(existsSync('app/components/VaultMarket.tsx')).toBe(false);

    const kiosk = readFileSync('app/components/KioskPanel.tsx', 'utf8');

    expect(kiosk.toLowerCase()).not.toContain('demo');
  });

  it('keeps kiosk listing disabled for zero package or policy ids', () => {
    const source = readFileSync('app/components/KioskPanel.tsx', 'utf8');

    expect(source).toContain('isConfiguredId');
    expect(source).toContain('isConfiguredId(pkg)');
    expect(source).toContain('isConfiguredId(policyId)');
  });

  it('prices sparse catalog and intent legs through the live quote path when a wallet is connected', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain('const quoteLeg = async');
    expect(source).toContain('scaleLegsToTargetGross(res.best.legs, target)');
    expect(source).toContain('legs.map(quoteLeg)');
    expect(source).toContain("setQuoteSource('devInspect live ask')");
    expect(source).not.toContain("quoteMode === 'draw'");
  });

  it('lets catalog presets expose their payout scale instead of fixed tiny unit payoffs', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain('catalogPayoutUsd');
    expect(source).toContain('scaleSparseTarget');
    expect(source).toContain('Target gross payout $');
  });

  it('uses gross max payout, not net max gain, for collateral ceilings', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain('maxPayout={maxGain(quote.legs, 0)}');
    expect(source).not.toContain('maxPayout={quote.maxGain}');
  });

  it('passes net max gain into mint gating', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain('netMaxGain={quote?.maxGain}');
  });

  it('uses a wallet-owned PredictManager instead of the deployer manager for arbitrary buyers', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain('walletManagerId');
    expect(source).toContain('TradingAccountPanel');
    // Arbitrary buyers (who do not own the funded manager) resolve to their own
    // wallet-created manager; only the funded manager's owner reuses it.
    expect(source).toContain('managerId: effectiveManagerId');
    expect(source).toContain('walletManagerId ?? appConfig.managerId');
    expect(source).toContain('ownsConfigManager');
    expect(source).toContain('onManagerReady={setWalletManagerId}');
  });

  it('lets users pick a live oracle expiry and cash out manager dUSDC', () => {
    const builder = readFileSync('app/components/Builder.tsx', 'utf8');
    const oraclePanel = readFileSync('app/components/OraclePanel.tsx', 'utf8');
    const tradingAccount = readFileSync('app/components/TradingAccountPanel.tsx', 'utf8');

    expect(builder).toContain('activeOracleChoices');
    expect(builder).toContain('selectedOracleId');
    expect(builder).toContain('onOracleChange');
    expect(oraclePanel).toContain('oracleOptions');
    expect(oraclePanel).toContain('<select');
    expect(tradingAccount).toContain('getManagerBalance');
    expect(tradingAccount).toContain('buildWithdrawManagerTx');
    expect(tradingAccount).toContain('Withdraw balance to wallet');
  });

  it('keeps first-contact demo affordances visible on the landing lane', () => {
    const buyLane = readFileSync('app/components/BuyLane.tsx', 'utf8');
    const intentBar = readFileSync('app/components/IntentBar.tsx', 'utf8');
    const oraclePanel = readFileSync('app/components/OraclePanel.tsx', 'utf8');

    expect(buyLane).toContain('createIntentFallback');
    expect(buyLane).toContain('LiveProofStrip');
    expect(buyLane).toContain('Wallet-free preview');
    expect(intentBar).toContain('Plain-English builder');
    expect(oraclePanel).toContain('Choose another live expiry');
  });

  it('links live digests to a testnet explorer instead of showing bare text only', () => {
    const builder = readFileSync('app/components/Builder.tsx', 'utf8');
    const buyLane = readFileSync('app/components/BuyLane.tsx', 'utf8');
    const positions = readFileSync('app/components/PositionsDashboard.tsx', 'utf8');

    expect(builder).toContain('ExplorerLink');
    expect(buyLane).toContain('ExplorerLink');
    expect(positions).toContain('ExplorerLink');
  });

  it('uses the wallet-owned PredictManager on the buy lane too', () => {
    const source = readFileSync('app/components/BuyLane.tsx', 'utf8');

    expect(source).toContain('walletManagerId');
    expect(source).toContain('TradingAccountPanel');
    expect(source).toContain('managerId: effectiveManagerId');
    expect(source).toContain('walletManagerId ?? appConfig.managerId');
    expect(source).toContain('ownsConfigManager');
    expect(source).toContain('onManagerReady={setWalletManagerId}');
  });

  it('passes selected manager ownership into mint gating so a mismatched manager cannot request an impossible tx', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain("queryKey: ['manager-owner'");
    expect(source).toContain('getManagerOwner(sui, oracle.managerId)');
    expect(source).toContain('accountAddress={account?.address}');
    expect(source).toContain('managerOwner={managerOwnerQuery.data}');
  });

  it('makes the active builder source explicit when catalog presets override template fields', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain('activeBuilderLabel');
    expect(source).toContain('Active builder');
    expect(source).toContain('Target gross payout $');
    expect(source).toContain('Catalog preset and Target gross payout $ are active');
    expect(source).not.toContain('drawn payoff');
  });

  it('renders only the active builder controls instead of showing ignored template fields beside presets', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).toContain("setQuoteMode('template')");
    expect(source).toContain("setQuoteMode('catalog')");
    expect(source).toContain("quoteMode === 'template' ? (");
    expect(source).toContain("quoteMode === 'catalog' ? (");
  });

  it('refreshes and highlights owned positions after a mint completes', () => {
    const builder = readFileSync('app/components/Builder.tsx', 'utf8');
    const positions = readFileSync('app/components/PositionsDashboard.tsx', 'utf8');

    expect(builder).toContain('positionsRefreshKey');
    expect(builder).toContain('handleMinted');
    expect(builder).toContain('onMinted={handleMinted}');
    expect(builder).toContain('refreshKey={positionsRefreshKey}');
    expect(builder).toContain('lastMintPositionId={mintedPositionId}');
    expect(builder).toContain('<AdvancedSection title="Owned positions" label="Portfolio" defaultOpen>');
    expect(positions).toContain('lastMintPositionId');
    expect(positions).toContain('positions.refetch()');
  });

  it('removes unwired or confusing advanced panels from the live builder page', () => {
    const source = readFileSync('app/components/Builder.tsx', 'utf8');

    expect(source).not.toContain('DrawPayoffCanvas');
    expect(source).not.toContain('Draw payoff');
    expect(source).not.toContain('Backtester');
    expect(source).not.toContain('KioskPanel');
    expect(source).not.toContain('CreatorLeaderboard');
    expect(source).not.toContain('Surface shifts');
    expect(source).not.toContain('ScenarioSliders');
    expect(source).not.toContain('PortfolioPanel');
    expect(source).not.toContain('TranchePanel');
    expect(source).not.toContain('VaultMarket');
    expect(source).not.toContain('RfqPanel');
  });

  it('shows gross payout separately from net max gain', () => {
    const source = readFileSync('app/components/StructureSummary.tsx', 'utf8');

    expect(source).toContain('Gross payout');
    expect(source).toContain('Net Max Gain');
    expect(source).toContain('maxGain(quote.legs, 0)');
  });
});
