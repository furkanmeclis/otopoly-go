/**
 * Theme background + faint dot grid (faded out over the reserved text zone)
 * + one slow-drifting terracotta glow behind the stage.
 */
import type React from "react";
import { AbsoluteFill } from "remotion";
import { alpha } from "../lib/anim";
import { STAGE_H, STAGE_W, type Layout } from "../lib/stage";
import type { Palette } from "../theme";

export const Background: React.FC<{
  P: Palette;
  layout: Layout;
  frame: number;
  box: { s: number; left: number; top: number };
}> = ({ P, layout, frame, box }) => {
  const cx = box.left + (STAGE_W * box.s) / 2;
  const cy = box.top + (STAGE_H * box.s) / 2;
  // one slow loop over the whole film, small amplitude
  const t = (frame / 300) * Math.PI * 2;
  const gx = cx + Math.sin(t) * 46 * box.s;
  const gy = cy + Math.sin(t * 0.5 + 0.6) * 34 * box.s;
  const r = 430 * box.s;

  const zoneMask =
    layout === "landscape"
      ? "linear-gradient(90deg, transparent 0%, transparent 46%, black 62%, black 100%)"
      : "linear-gradient(180deg, transparent 0%, transparent 42%, black 56%, black 100%)";
  const radial = `radial-gradient(ellipse ${560 * box.s}px ${480 * box.s}px at ${cx}px ${cy}px, black 0%, black 35%, transparent 100%)`;

  return (
    <AbsoluteFill style={{ background: P.bg }}>
      <AbsoluteFill style={{ maskImage: zoneMask, WebkitMaskImage: zoneMask }}>
        <AbsoluteFill
          style={{
            opacity: P.gridOpacity,
            backgroundImage: `radial-gradient(${P.skeleton} 1.5px, transparent 1.6px)`,
            backgroundSize: "28px 28px",
            backgroundPosition: "14px 14px",
            maskImage: radial,
            WebkitMaskImage: radial,
          }}
        />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: gx - r,
          top: gy - r,
          width: r * 2,
          height: r * 2,
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 50%, ${alpha(P.primary, P.glowAlpha)} 0%, ${alpha(P.primary, P.glowAlpha * 0.45)} 38%, ${alpha(P.primary, 0)} 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};
