import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Last Bite — Order Swiggy on WhatsApp";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(252, 128, 25, 0.12), transparent 60%), #fdfbf7",
          padding: "72px 80px",
          color: "#1c1c1c",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: "#1c1c1c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: "#FC8019",
              }}
            />
          </div>
          Last Bite
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "center",
            gap: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              alignSelf: "flex-start",
              padding: "8px 16px",
              borderRadius: 999,
              background: "rgba(252, 128, 25, 0.08)",
              color: "#9c4a0e",
              fontSize: 20,
              fontWeight: 500,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: "#FC8019",
              }}
            />
            Powered by Swiggy · Beta
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 86,
              fontWeight: 600,
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
              color: "#0e0e0e",
            }}
          >
            <div>Order Swiggy in plain English.</div>
            <div style={{ color: "#7a7a7a" }}>Confirm before you regret.</div>
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#5a5a5a",
              lineHeight: 1.4,
              maxWidth: 920,
            }}
          >
            Three confirmation gates and a 30-second grace timer before any COD order goes through.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 18,
            color: "#7a7a7a",
          }}
        >
          <span>swiggy-mcp.vercel.app</span>
          <span
            style={{
              display: "flex",
              gap: 24,
            }}
          >
            <span>Calorie · ETA · Final</span>
            <span>30s STOP window</span>
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
