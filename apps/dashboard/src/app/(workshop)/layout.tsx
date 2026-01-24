import './workshop.css';

export default function WorkshopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div id="app" className="botspace-root">{children}</div>;
}
