/** Home (v4) brings its own navbar and footer, so it sits outside the marketing layout. */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh overflow-x-clip antialiased">{children}</div>;
}
