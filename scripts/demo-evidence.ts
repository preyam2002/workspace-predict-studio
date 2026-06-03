import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { formatDemoEvidenceBundle, type DemoEvidenceCommand } from '../lib/demo-evidence';

interface EvidenceCommand {
  label: string;
  args: string[];
}

const commands: EvidenceCommand[] = [
  { label: 'Live proof', args: ['live:proof'] },
  { label: 'Verify first', args: ['verify:first'] },
  { label: 'Address inventory', args: ['address:inventory'] },
  { label: 'DeepBook Spot check', args: ['deepbook:spot-check', '--', '--all-addresses', '--dry-run'] },
  { label: 'Sample settlement', args: ['settle:sample'] },
  { label: 'Vault settlement', args: ['settle:vault'] },
  { label: 'Submission packet check', args: ['submission:check'] },
  { label: 'Hackathon readiness', args: ['hackathon:status'] },
];

function runCommand(command: EvidenceCommand): DemoEvidenceCommand {
  const printable = `pnpm ${command.args.join(' ')}`;
  try {
    const output = execFileSync('pnpm', command.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { label: command.label, command: printable, exitCode: 0, output };
  } catch (err) {
    const error = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const output = `${String(error.stdout ?? '')}${String(error.stderr ?? '')}`.trim() || error.message || 'command failed';
    return { label: command.label, command: printable, exitCode: error.status ?? 1, output };
  }
}

const outputPath = process.argv[2] ?? 'docs/DEMO_EVIDENCE.md';
const evidence = commands.map(runCommand);
const markdown = formatDemoEvidenceBundle({ generatedAt: new Date().toISOString(), commands: evidence });
writeFileSync(outputPath, markdown);
console.log(`demo_evidence\t${outputPath}`);
console.log(`commands\t${evidence.length}`);
if (evidence.some((item) => item.exitCode !== 0)) process.exitCode = 1;
