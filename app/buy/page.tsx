import { BuyLane } from '../components/BuyLane';

export default async function BuyPage({ searchParams }: { searchParams?: Promise<{ note?: string }> }) {
  const params = searchParams ? await searchParams : {};
  return <BuyLane initialNoteParam={params.note} />;
}
