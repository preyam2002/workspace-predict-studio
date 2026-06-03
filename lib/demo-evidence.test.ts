import { describe, expect, it } from 'vitest';
import { formatDemoEvidenceBundle, type DemoEvidenceCommand } from './demo-evidence';

describe('demo evidence bundle', () => {
  it('formats command outputs for recording and submission handoff', () => {
    const commands: DemoEvidenceCommand[] = [
      {
        label: 'Live proof',
        command: 'pnpm live:proof',
        exitCode: 0,
        output: 'Live proof summary\npackage: 0xpackage',
      },
      {
        label: 'Hackathon status',
        command: 'pnpm hackathon:status',
        exitCode: 0,
        output: 'hackathon_ready\tfalse\nsummary\tpass=4\tblocked=5\tfail=0',
      },
    ];

    const bundle = formatDemoEvidenceBundle({ generatedAt: '2026-06-03T10:00:00.000Z', commands });

    expect(bundle).toContain('# Predict Studio Demo Evidence');
    expect(bundle).toContain('Generated: 2026-06-03T10:00:00.000Z');
    expect(bundle).toContain('## Live proof');
    expect(bundle).toContain('Command: `pnpm live:proof`');
    expect(bundle).toContain('Exit: `0`');
    expect(bundle).toContain('```text\nLive proof summary\npackage: 0xpackage\n```');
    expect(bundle).toContain('## Hackathon status');
    expect(bundle).toContain('hackathon_ready\tfalse');
  });
});
