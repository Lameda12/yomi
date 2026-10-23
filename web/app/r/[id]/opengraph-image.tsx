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
  // Kept deliberately plain: the image renderer is not a browser. Rows are single text nodes with an explicit line
  // height and margins (no gap, no opacity, no fragments), which lay out correctly.
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a0a", color: "#ededed" }}>
        <div style={{ display: "flex", fontSize: 48, fontWeight: 700, lineHeight: 1.2, marginBottom: 24 }}>
          Yomi <span style={{ color: "#f97316", marginLeft: 16 }}>読み</span>
        </div>
        {/* No fragment here: the renderer lays a fragment's children out sideways. */}
        {s && <div style={{ display: "flex", fontSize: 200, fontWeight: 700, lineHeight: 1, color: "#f97316", marginBottom: 24 }}>{clock(s.solve_ms)}</div>}
        {s && <div style={{ display: "flex", fontSize: 38, lineHeight: 1.3, marginBottom: 16 }}>{resultLine(s)}</div>}
        {s && <div style={{ display: "flex", fontSize: 34, lineHeight: 1.3, color: "#999999" }}>Can you beat it?</div>}
        {!s && <div style={{ display: "flex", fontSize: 52, lineHeight: 1.3 }}>Read the grid. One path, every cell.</div>}
      </div>
    ),
    size,
  );
}
