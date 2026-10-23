import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { clock } from "@/lib/clock";
import { resultLine } from "@/lib/share";
import { getSharedSolve } from "@/lib/store";

export const alt = "A Yomi result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link preview: the time in big type and one line of who/what. Falls back to a plain Yomi card if the solve is missing.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  const s = await getSharedSolve(id).catch(() => null);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a0a", color: "#ededed", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
          Yomi <span style={{ color: "#f97316", marginLeft: 16 }}>読み</span>
        </div>
        {s ? (
          <>
            <div style={{ display: "flex", fontSize: 220, fontWeight: 800, color: "#f97316" }}>{clock(s.solve_ms)}</div>
            <div style={{ display: "flex", fontSize: 42, opacity: 0.85 }}>{resultLine(s)}</div>
            <div style={{ display: "flex", fontSize: 36, opacity: 0.6 }}>Can you beat it?</div>
          </>
        ) : (
          <div style={{ display: "flex", fontSize: 56 }}>Read the grid. One path, every cell.</div>
        )}
      </div>
    ),
    size,
  );
}
