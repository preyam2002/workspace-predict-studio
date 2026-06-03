export interface DemoEvidenceCommand {
  label: string;
  command: string;
  exitCode: number;
  output: string;
}

export interface DemoEvidenceBundle {
  generatedAt: string;
  commands: DemoEvidenceCommand[];
}

export function formatDemoEvidenceBundle(bundle: DemoEvidenceBundle): string {
  const lines = ['# Predict Studio Demo Evidence', '', `Generated: ${bundle.generatedAt}`, ''];
  for (const item of bundle.commands) {
    lines.push(`## ${item.label}`, '', `Command: \`${item.command}\``, `Exit: \`${item.exitCode}\``, '', '```text');
    lines.push(item.output.trimEnd());
    lines.push('```', '');
  }
  return lines.join('\n').trimEnd() + '\n';
}
