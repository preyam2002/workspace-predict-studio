import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parsePublishResult } from '../lib/deploy-utils';

const existing = existsSync('./deploy.json') ? JSON.parse(readFileSync('./deploy.json', 'utf8')) : {};
if (existing.packageId && process.env.FORCE_DEPLOY !== '1') {
  console.log('using existing predict_studio:', existing.packageId);
  if (existing.shareFactoryId) console.log('share factory:', existing.shareFactoryId);
  process.exit(0);
}

const out = execSync('sui client publish ./move --allow-dirty --gas-budget 250000000 --json', { encoding: 'utf8' });
const res = JSON.parse(out);
const { packageId, shareFactoryId } = parsePublishResult(res);

writeFileSync('./deploy.json', JSON.stringify({ ...existing, packageId, shareFactoryId, publishedAt: new Date().toISOString() }, null, 2));
console.log('published predict_studio:', packageId);
if (shareFactoryId) console.log('share factory:', shareFactoryId);
