import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const out = execSync('sui client publish ./move --gas-budget 500000000 --json', { encoding: 'utf8' });
const res = JSON.parse(out);
const packageId = res.objectChanges?.find((change: { type?: string }) => change.type === 'published')?.packageId;
if (!packageId) throw new Error('Publish succeeded but package id was not found in objectChanges');

const existing = existsSync('./deploy.json') ? JSON.parse(readFileSync('./deploy.json', 'utf8')) : {};
writeFileSync('./deploy.json', JSON.stringify({ ...existing, packageId, publishedAt: new Date().toISOString() }, null, 2));
console.log('published predict_studio:', packageId);
