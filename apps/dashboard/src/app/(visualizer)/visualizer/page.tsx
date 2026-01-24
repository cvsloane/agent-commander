import dynamic from 'next/dynamic';

// Dynamic import with SSR disabled for WebGL/Three.js components
const VisualizerPage = dynamic(
  () => import('@/components/visualizer/VisualizerPage').then((mod) => mod.VisualizerPage),
  { ssr: false }
);

export default function VisualizerRoute() {
  return <VisualizerPage />;
}
