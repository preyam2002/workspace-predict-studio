import { readFileSync } from 'node:fs';
import { formatSubmissionPacketStatus, validateSubmissionPacket } from '../lib/submission-packet';

const path = process.argv[2] ?? 'docs/SUBMISSION.md';
const validation = validateSubmissionPacket(readFileSync(path, 'utf8'));
console.log(formatSubmissionPacketStatus(validation));
if (!validation.ok) process.exitCode = 1;
