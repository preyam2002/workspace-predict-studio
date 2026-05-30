import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parsePublishResult } from '../lib/deploy-utils';

const out = execSync('sui client publish ./move --gas-budget 500000000 --json', { encoding: 'utf8' });
const res = JSON.parse(out);
const { packageId, shareFactoryId } = parsePublishResult(res);

const existing = existsSync('./deploy.json') ? JSON.parse(readFileSync('./deploy.json', 'utf8')) : {};
writeFileSync('./deploy.json', JSON.stringify({ ...existing, packageId, shareFactoryId, publishedAt: new Date().toISOString() }, null, 2));
console.log('published predict_studio:', packageId);
if (shareFactoryId) console.log('share factory:', shareFactoryId);
