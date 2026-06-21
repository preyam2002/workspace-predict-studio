import { execFileSync } from 'node:child_process';
import {
  classifyConfigGates,
  classifyGateOutput,
  formatHackathonStatus,
  type HackathonGate,
} from '../lib/hackathon-status';
import { loadLocalEnv, withWritableSuiConfig } from '../lib/script-env';

interface GateCommand {
  name: string;
  args: string[];
}

const commands: GateCommand[] = [
  { name: 'verify:first', args: ['verify:first'] },
  { name: 'address:inventory', args: ['address:inventory'] },
  { name: 'deepbook:spot-check', args: ['deepbook:spot-check', '--', '--all-addresses', '--dry-run'] },
  { name: 'settle:sample', args: ['settle:sample'] },
  { name: 'settle:vault', args: ['settle:vault'] },
  { name: 'collateral:demo', args: ['collateral:demo'] },
  { name: 'rfq:demo', args: ['rfq:demo', '--', '--verify'] },
  { name: 'kiosk:demo', args: ['kiosk:demo', '--', '--verify'] },
];

function runGate(command: GateCommand, env: NodeJS.ProcessEnv): HackathonGate {
  try {
    const output = execFileSync('pnpm', command.args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    return classifyGateOutput(command.name, output);
  } catch (err) {
    const error = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const detail = `${String(error.stdout ?? '')}${String(error.stderr ?? '')}`.trim() || error.message || 'command failed';
    return { name: command.name, status: 'fail', detail };
  }
}

const strict = process.argv.includes('--strict');
const env = withWritableSuiConfig(loadLocalEnv());
const shellGates = commands.map((command) => runGate(command, env));
const gates = [...shellGates, ...classifyConfigGates(env, shellGates)];
const report = formatHackathonStatus(gates);
console.log(report);

if (gates.some((gate) => gate.status === 'fail') || (strict && gates.some((gate) => gate.status === 'blocked'))) {
  process.exitCode = 1;
}
