import { existsSync, readFileSync } from 'node:fs';
import { formatLiveProof, type LiveProofDeployInfo } from '../lib/live-proof';

if (!existsSync('./deploy.json')) throw new Error('deploy.json is missing');

const deploy = JSON.parse(readFileSync('./deploy.json', 'utf8')) as LiveProofDeployInfo;
console.log(formatLiveProof(deploy));
