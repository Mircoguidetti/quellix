import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

/**
 * Open Graph card in the style of the landing hero: black, a dot grid, the viewfinder corners in
 * the accent colour, the logo and the page's headline.
 */
export function ogImage(eyebrow: string, headline: string) {
  const corner = (pos: Record<string, number>, borders: Record<string, string>) => (
    <div style={{ position: "absolute", width: 34, height: 34, ...pos, ...borders }} />
  );
  const line = "3px solid rgba(242,243,245,0.45)";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#000",
          backgroundImage:
            "radial-gradient(circle at 50% 40%, rgba(143,180,255,0.22), rgba(143,180,255,0) 55%), radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 36px 36px",
          color: "#f2f3f5",
          position: "relative",
        }}
      >
        {corner({ left: 48, top: 48 }, { borderLeft: line, borderTop: line })}
        {corner({ right: 48, top: 48 }, { borderRight: line, borderTop: line })}
        {corner({ left: 48, bottom: 48 }, { borderLeft: line, borderBottom: line })}
        {corner({ right: 48, bottom: 48 }, { borderRight: line, borderBottom: line })}
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, letterSpacing: 6, fontWeight: 600 }}>
          <div style={{ width: 30, height: 30, border: "3px solid #f2f3f5", borderRadius: 5, display: "flex", padding: 4 }}>
            <div style={{ flex: 1, border: "3px solid #8fb4ff", borderRadius: 2 }} />
          </div>
          ORMES
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 26, color: "#8fb4ff", letterSpacing: 3, textTransform: "uppercase" }}>{eyebrow}</div>
          <div style={{ fontSize: 76, lineHeight: 1.04, letterSpacing: -2, maxWidth: 980 }}>{headline}</div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24 }}>
          {[
            ["accept", "#7ed6a8"],
            ["review", "#8fb4ff"],
            ["reject", "#ff8a7a"],
          ].map(([label, color]) => (
            <div key={label} style={{ display: "flex", padding: "6px 16px", borderRadius: 10, color, background: "rgba(255,255,255,0.06)" }}>
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    ogSize,
  );
}
