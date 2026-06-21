import { Transaction } from '@mysten/sui/transactions';

// Tradeable creator-note (Kiosk) PTB builders. A note is wrapped as a `StudioNote`, locked
// into a Kiosk under the StudioNote TransferPolicy, and listed; buyers pay a capped royalty
// to the publisher on resale (emitting `note_kiosk::RoyaltyPaid`, which feeds the leaderboard).

const STUDIO_NOTE = (pkg: string) => `${pkg}::note_kiosk::StudioNote`;

/** Floor royalty in the same basis the Move rule uses: paid * bps / 10_000. */
export function royaltyAmount(price: number, bps: number): number {
  return Math.floor((price * bps) / 10_000);
}

export interface MintListParams {
  pkg: string;
  policyId: string;
  structureHash: number[] | Uint8Array;
  publisher: string;
  premium: number;
  maturityMs: number;
  royaltyBps: number;
  price: number;
  seller: string;
}

/** Mint a StudioNote, lock it in a fresh shared Kiosk, and list it for sale, in one PTB. */
export function buildMintAndListNoteTx(p: MintListParams): Transaction {
  const tx = new Transaction();
  const [kiosk, cap] = tx.moveCall({ target: '0x2::kiosk::new' });
  const note = tx.moveCall({
    target: `${p.pkg}::note_kiosk::new_note`,
    arguments: [
      tx.pure.vector('u8', Array.from(p.structureHash)),
      tx.pure.address(p.publisher),
      tx.pure.u64(BigInt(p.premium)),
      tx.pure.u64(BigInt(p.maturityMs)),
      tx.pure.u16(p.royaltyBps),
    ],
  });
  const noteId = tx.moveCall({ target: `${p.pkg}::note_kiosk::id`, arguments: [note] });
  tx.moveCall({ target: `${p.pkg}::note_kiosk::lock_note`, arguments: [kiosk, cap, tx.object(p.policyId), note] });
  tx.moveCall({
    target: '0x2::kiosk::list',
    typeArguments: [STUDIO_NOTE(p.pkg)],
    arguments: [kiosk, cap, noteId, tx.pure.u64(BigInt(p.price))],
  });
  tx.moveCall({ target: '0x2::transfer::public_share_object', typeArguments: ['0x2::kiosk::Kiosk'], arguments: [kiosk] });
  tx.transferObjects([cap], p.seller);
  return tx;
}

export interface PurchaseParams {
  pkg: string;
  policyId: string;
  kioskId: string;
  noteId: string;
  price: number;
  royaltyBps: number;
  buyer: string;
}

/** Purchase a listed StudioNote and settle the royalty rule, in one PTB. */
export function buildPurchaseNoteTx(p: PurchaseParams): Transaction {
  const tx = new Transaction();
  const note = STUDIO_NOTE(p.pkg);
  const payment = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(p.price))]);
  const [item, request] = tx.moveCall({
    target: '0x2::kiosk::purchase',
    typeArguments: [note],
    arguments: [tx.object(p.kioskId), tx.pure.id(p.noteId), payment],
  });
  const royaltyCoin = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(royaltyAmount(p.price, p.royaltyBps)))]);
  tx.moveCall({ target: `${p.pkg}::note_kiosk::pay_royalty`, arguments: [tx.object(p.policyId), request, royaltyCoin] });
  tx.moveCall({ target: '0x2::transfer_policy::confirm_request', typeArguments: [note], arguments: [tx.object(p.policyId), request] });
  // item is the purchased note; royaltyCoin holds any rounding remainder after the fee split.
  tx.transferObjects([item, royaltyCoin], p.buyer);
  return tx;
}
