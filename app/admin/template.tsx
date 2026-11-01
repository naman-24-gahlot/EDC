// Re-mounted on every navigation inside this area, so each page settles in (.enter in
// app/globals.css: 280 ms, transform/opacity only, off for reduced motion and in print).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="enter">{children}</div>;
}
