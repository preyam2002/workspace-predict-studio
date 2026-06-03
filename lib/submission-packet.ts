export interface SubmissionPacketValidation {
  ok: boolean;
  missing: string[];
}

export const REQUIRED_SUBMISSION_SECTIONS = [
  'Project',
  'Short Description',
  'Problem',
  'Why Sui And DeepBook',
  'Technical Highlights',
  'Live Proof',
  'Demo Flow',
  'Current Disclosures',
  'Verification Commands',
] as const;

export const REQUIRED_LIVE_PROOF_LABELS = [
  'package:',
  'manager:',
  'vault:',
  'publish:',
  'sample mint:',
  'sample position:',
  'sample settle:',
  'vault roll:',
  'vault position:',
  'vault settle:',
] as const;

export const REQUIRED_SUBMISSION_COMMANDS = [
  'pnpm verify:first',
  'pnpm address:inventory',
  'pnpm deepbook:spot-check -- --all-addresses --dry-run',
  'pnpm settle:sample',
  'pnpm settle:vault',
  'pnpm live:proof',
  'pnpm hackathon:status',
  'pnpm submission:check',
  'pnpm demo:evidence',
  'pnpm vitest run',
  'pnpm build',
  'MOVE_HOME=$(mktemp -d) sui move test -p move',
] as const;

export const REQUIRED_DISCLOSURES = [
  'Enoki gasless lane is implemented',
  'Secondary market is implemented with Cetus/mock fallback',
  'Predict is testnet-only today',
  'DEMO_VIDEO_URL',
  'DEEPSURGE_SUBMISSION_URL',
] as const;

function includes(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

export function validateSubmissionPacket(markdown: string): SubmissionPacketValidation {
  const missing: string[] = [];
  for (const section of REQUIRED_SUBMISSION_SECTIONS) {
    if (!markdown.includes(`## ${section}`)) missing.push(`section: ${section}`);
  }
  for (const label of REQUIRED_LIVE_PROOF_LABELS) {
    if (!includes(markdown, label)) missing.push(`live proof: ${label}`);
  }
  for (const disclosure of REQUIRED_DISCLOSURES) {
    if (!includes(markdown, disclosure)) missing.push(`disclosure: ${disclosure}`);
  }
  for (const command of REQUIRED_SUBMISSION_COMMANDS) {
    if (!markdown.includes(command)) missing.push(`command: ${command}`);
  }
  return { ok: missing.length === 0, missing };
}

export function formatSubmissionPacketStatus(validation: SubmissionPacketValidation): string {
  const lines = [`submission_packet_ready\t${validation.ok}`];
  if (validation.ok) {
    lines.push('submission_packet_missing\t0');
  } else {
    lines.push(`submission_packet_missing\t${validation.missing.length}`);
    for (const item of validation.missing) lines.push(`missing\t${item}`);
  }
  return lines.join('\n');
}
