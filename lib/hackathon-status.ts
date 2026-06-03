export type HackathonGateStatus = 'pass' | 'blocked' | 'fail';

export interface HackathonGate {
  name: string;
  status: HackathonGateStatus;
  detail: string;
}

export interface HackathonSummary {
  pass: number;
  blocked: number;
  fail: number;
  ready: boolean;
}

type Env = Record<string, string | undefined>;

function missing(env: Env, keys: string[]): string[] {
  return keys.filter((key) => !env[key]);
}

function positiveDisplay(value: string | undefined): boolean {
  return Boolean(value && !/^0(?:\.0*)?$/.test(value));
}

export function classifyConfigGates(env: Env, shellGates: HackathonGate[] = []): HackathonGate[] {
  const enokiMissing = missing(env, [
    'NEXT_PUBLIC_ENOKI_API_KEY',
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
    'ENOKI_PRIVATE_KEY',
  ]);
  const secondaryMarketConfigured = Boolean(env.NEXT_PUBLIC_CETUS_STUDIO_POOL_ID);
  const deepbookSpotReady = shellGates.some((gate) => gate.name === 'deepbook:spot-check' && gate.status === 'pass');
  return [
    enokiMissing.length === 0
      ? { name: 'enoki:config', status: 'pass', detail: 'Enoki client and sponsor credentials are configured' }
      : { name: 'enoki:config', status: 'blocked', detail: `missing ${enokiMissing.join(', ')}` },
    secondaryMarketConfigured
      ? { name: 'secondary-market:config', status: 'pass', detail: 'STUDIO_LP/dUSDC secondary-market pool is configured' }
      : deepbookSpotReady
        ? {
            name: 'secondary-market:config',
            status: 'pass',
            detail: 'DeepBook Spot secondary-market path is funded and registry-ready',
          }
      : {
          name: 'secondary-market:config',
          status: 'blocked',
          detail: 'missing NEXT_PUBLIC_CETUS_STUDIO_POOL_ID or funded DeepBook Spot pool',
        },
    env.DEMO_VIDEO_URL
      ? { name: 'demo:video', status: 'pass', detail: 'demo video URL is recorded' }
      : { name: 'demo:video', status: 'blocked', detail: 'missing DEMO_VIDEO_URL' },
    env.DEEPSURGE_SUBMISSION_URL
      ? { name: 'deepsurge:submission', status: 'pass', detail: 'DeepSurge submission URL is recorded' }
      : { name: 'deepsurge:submission', status: 'blocked', detail: 'missing DEEPSURGE_SUBMISSION_URL' },
  ];
}

export function classifyGateOutput(name: string, output: string): HackathonGate {
  if (name === 'verify:first' && output.includes('devinspect_quote\tok')) {
    return { name, status: 'pass', detail: 'live Predict oracle/devInspect gate passed' };
  }
  if (name === 'deepbook:spot-check') {
    if (output.includes('deepbook_spot_dry_run\tpass')) {
      return { name, status: 'pass', detail: 'DeepBook Spot pool creation dry-run passed' };
    }
    if (output.includes('deepbook_spot_status\tblocked_missing_deep')) {
      return { name, status: 'blocked', detail: 'needs 500 funded DEEP for DeepBook Spot pool creation' };
    }
    if (output.includes('deepbook_spot_status\tready_needs_registry')) {
      return { name, status: 'blocked', detail: 'needs DEEPBOOK_REGISTRY_ID for DeepBook Spot pool dry-run' };
    }
    if (output.includes('deepbook_spot_status\tready_to_dry_run')) {
      return { name, status: 'pass', detail: 'wallet has enough DEEP for DeepBook Spot dry-run' };
    }
  }
  if (name === 'address:inventory') {
    const active = output
      .split('\n')
      .find((line) => line.startsWith('active\t'))
      ?.split('\t');
    const activeAlias = active?.[1];
    const activeAddress = active?.[2];
    const activeSummary = output
      .split('\n')
      .map((line) => line.split('\t'))
      .find((cols) => cols[0] === 'address_summary' && cols[1] === activeAlias && cols[2] === activeAddress);
    if (!activeSummary) return { name, status: 'fail', detail: 'active wallet inventory row missing' };
    const hasSui = positiveDisplay(activeSummary[4]);
    const hasStudioLp = positiveDisplay(activeSummary[6]);
    if (hasSui && hasStudioLp) {
      return { name, status: 'pass', detail: 'active wallet has SUI and STUDIO_LP for live demo controls' };
    }
    const missingAssets = [hasSui ? '' : 'SUI', hasStudioLp ? '' : 'STUDIO_LP'].filter(Boolean).join(', ');
    return { name, status: 'blocked', detail: `active wallet missing ${missingAssets}` };
  }
  if (name === 'settle:sample') {
    if (output.includes('oracle_not_settled')) return { name, status: 'blocked', detail: 'sample oracle has not settled yet' };
    if (output.includes('settle_execute') || output.includes('position_already_settled')) {
      return { name, status: 'pass', detail: 'sample settlement digest recorded or executable' };
    }
  }
  if (name === 'settle:vault') {
    if (output.includes('oracle_not_settled')) return { name, status: 'blocked', detail: 'vault oracle has not settled yet' };
    if (output.includes('vault_settle_execute') || output.includes('vault_already_settled')) {
      return { name, status: 'pass', detail: 'vault settlement digest recorded or executable' };
    }
    if (output.includes('vault_no_open_strategy')) return { name, status: 'pass', detail: 'vault has no open strategy to settle' };
  }
  return { name, status: 'fail', detail: 'unexpected output' };
}

export function summarizeGateStatuses(gates: HackathonGate[]): HackathonSummary {
  const pass = gates.filter((gate) => gate.status === 'pass').length;
  const blocked = gates.filter((gate) => gate.status === 'blocked').length;
  const fail = gates.filter((gate) => gate.status === 'fail').length;
  return { pass, blocked, fail, ready: blocked === 0 && fail === 0 };
}

export function formatHackathonStatus(gates: HackathonGate[]): string {
  const summary = summarizeGateStatuses(gates);
  const lines = [
    `hackathon_ready\t${summary.ready}`,
    `summary\tpass=${summary.pass}\tblocked=${summary.blocked}\tfail=${summary.fail}`,
  ];
  for (const gate of gates) lines.push(`gate\t${gate.status}\t${gate.name}\t${gate.detail}`);
  return lines.join('\n');
}
