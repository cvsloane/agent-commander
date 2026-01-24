import dynamic from 'next/dynamic';

const BotspaceOrbit = dynamic(
  () => import('@/components/botspace/BotspaceOrbit').then((mod) => mod.BotspaceOrbit),
  { ssr: false }
);

export default function WorkshopRoute() {
  return <BotspaceOrbit />;
}
