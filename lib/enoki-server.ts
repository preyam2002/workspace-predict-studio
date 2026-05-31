import { EnokiClient } from '@mysten/enoki';

type EnokiNetwork = 'testnet' | 'mainnet' | 'devnet';

interface SponsorInput {
  network: EnokiNetwork;
  transactionKindBytes: string;
  sender: string;
  allowedMoveCallTargets: string[];
  allowedAddresses: string[];
}

interface ExecuteInput {
  digest: string;
  signature: string;
}

export interface SponsorRequestBody {
  transactionKindBytes?: string;
  transactionBlockKindBytes?: string;
  sender?: string;
  network?: EnokiNetwork;
}

export interface ExecuteRequestBody {
  digest?: string;
  signature?: string;
}

export interface EnokiSponsorClient {
  createSponsoredTransaction(input: SponsorInput): Promise<unknown>;
}

export interface EnokiExecuteClient {
  executeSponsoredTransaction(input: ExecuteInput): Promise<unknown>;
}

function privateKey(env: Record<string, string | undefined>): string {
  const apiKey = env.ENOKI_PRIVATE_KEY;
  if (!apiKey) throw new Error('ENOKI_PRIVATE_KEY is required');
  return apiKey;
}

function studioPackage(env: Record<string, string | undefined>): string {
  const pkg = env.NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE;
  if (!pkg) throw new Error('NEXT_PUBLIC_PREDICT_STUDIO_PACKAGE is required');
  return pkg;
}

function defaultNetwork(env: Record<string, string | undefined>): EnokiNetwork {
  return (env.NEXT_PUBLIC_SUI_NETWORK as EnokiNetwork | undefined) ?? 'testnet';
}

function sponsorClient(env: Record<string, string | undefined>): EnokiSponsorClient & EnokiExecuteClient {
  return new EnokiClient({ apiKey: privateKey(env) });
}

export async function createSponsoredMintTransaction(
  body: SponsorRequestBody,
  env: Record<string, string | undefined> = process.env,
  client: EnokiSponsorClient = sponsorClient(env),
) {
  const transactionKindBytes = body.transactionKindBytes ?? body.transactionBlockKindBytes;
  if (!transactionKindBytes) throw new Error('transactionKindBytes is required');
  if (!body.sender) throw new Error('sender is required');

  return client.createSponsoredTransaction({
    network: body.network ?? defaultNetwork(env),
    transactionKindBytes,
    sender: body.sender,
    allowedMoveCallTargets: [`${studioPackage(env)}::studio::build_and_mint_to_sender`],
    allowedAddresses: [body.sender],
  });
}

export async function executeSponsoredMintTransaction(
  body: ExecuteRequestBody,
  env: Record<string, string | undefined> = process.env,
  client: EnokiExecuteClient = sponsorClient(env),
) {
  if (!body.digest) throw new Error('digest is required');
  if (!body.signature) throw new Error('signature is required');
  return client.executeSponsoredTransaction({ digest: body.digest, signature: body.signature });
}
