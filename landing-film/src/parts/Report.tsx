/** End-of-day report card (440×380). */
import type React from "react";
import { alpha, ramp } from "../lib/anim";
import { FONT, type Palette } from "../theme";
import { Skel } from "./JobCard";
import { CarGlyph } from "./icons";

export const REPORT_W = 440;
export const REPORT_H = 380;
const BARS = [0.46, 0.64, 0.4, 0.76, 0.56, 0.7, 0.96];

export const Report: React.FC<{ P: Palette; f: number }> = ({ P, f }) => {
  const count = Math.round(ramp(f, 274, 286) * 24);
  const ring = ramp(f, 273, 287) * 0.86;
  const R = 44;
  const C = 2 * Math.PI * R;
  return (
    <div
      style={{
        position: "relative",
        width: REPORT_W,
        height: REPORT_H,
        borderRadius: 28,
        background: P.card,
        backgroundImage: P.sheen,
        border: `1px solid ${P.border}`,
        boxSizing: "border-box",
        boxShadow: P.shadowLift,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 28,
          top: 28,
          width: 44,
          height: 44,
          borderRadius: 14,
          background: alpha(P.primary, P.name === "dark" ? 0.16 : 0.1),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CarGlyph size={24} color={P.primary} stroke={2} />
      </div>
      <Skel x={84} y={44} w={92} h={11} color={P.skeleton} />
      <div
        style={{
          position: "absolute",
          left: 26,
          top: 80,
          fontSize: 76,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: -2,
          color: P.fg,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </div>
      <svg width={112} height={112} viewBox="0 0 112 112" style={{ position: "absolute", left: 300, top: 26 }}>
        <circle cx={56} cy={56} r={R} fill="none" stroke={P.skeleton} strokeWidth={12} />
        <circle
          cx={56}
          cy={56}
          r={R}
          fill="none"
          stroke={P.primary}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${C * ring} ${C}`}
          transform="rotate(-90 56 56)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 300,
          top: 26,
          width: 112,
          height: 112,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          fontWeight: 800,
          color: P.fg,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {Math.round(ring * 100)}
        <span style={{ fontSize: 13, fontWeight: 700, color: P.text2, marginLeft: 1, marginTop: 6 }}>%</span>
      </div>
      {/* weekly bars */}
      {BARS.map((h, i) => {
        const p = ramp(f, 273 + i * 1.2, 282 + i * 1.2);
        const H = 132 * h * p;
        const last = i === BARS.length - 1;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 28 + i * 56,
              top: 342 - H,
              width: 40,
              height: H,
              borderRadius: 10,
              background: last ? P.primary : P.name === "dark" ? P.skeleton2 : P.skeleton2,
              boxShadow: last ? `0 8px 20px ${alpha(P.primary, 0.3)}` : "none",
            }}
          />
        );
      })}
      <div style={{ position: "absolute", left: 28, top: 350, width: 384, height: 2, borderRadius: 1, background: P.skeleton }} />
    </div>
  );
};
