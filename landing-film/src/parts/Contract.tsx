/** Document card (360×400) + OTP row underneath (y 422…478). */
import type React from "react";
import { interpolateColors, spring } from "remotion";
import { alpha, ramp } from "../lib/anim";
import { FONT, type Palette } from "../theme";
import { Skel } from "./JobCard";
import { DrawCheck, FileSignature } from "./icons";

export const DOC_W = 360;
export const DOC_H = 400;
const DIGITS = [4, 8, 2, 9, 1, 7];
const OTP_START = 232;
const LINES = [304, 288, 300, 252, 296, 176];

const SIGNATURE =
  "M4 40 C 14 6, 26 2, 28 28 S 34 58, 46 30 S 62 2, 70 26 S 80 50, 92 30 C 100 16, 110 18, 112 32 S 128 38, 140 22 C 148 12, 156 14, 160 26 C 164 36, 174 34, 196 24";

export const Contract: React.FC<{ P: Palette; f: number; fps: number }> = ({ P, f, fps }) => {
  const sig = ramp(f, 249, 260, 0, 1, (t) => t * t * (3 - 2 * t));
  const flash = ramp(f, 248, 251) * (1 - ramp(f, 255, 262));
  const stamp = f < 258 ? 0 : spring({ frame: f - 258, fps, config: { damping: 12, stiffness: 150, mass: 0.7 } });
  const filled = DIGITS.filter((_, i) => f >= OTP_START + i * 3).length;

  return (
    <div style={{ position: "relative", width: DOC_W, height: 480, fontFamily: FONT }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: DOC_W,
          height: DOC_H,
          borderRadius: 24,
          background: P.card,
          backgroundImage: P.sheen,
          border: `1px solid ${P.border}`,
          boxSizing: "border-box",
          boxShadow: P.shadowLift,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 28,
            top: 28,
            width: 46,
            height: 46,
            borderRadius: 14,
            background: alpha(P.primary, P.name === "dark" ? 0.16 : 0.1),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <FileSignature size={24} color={P.primary} stroke={2} />
        </div>
        <Skel x={88} y={33} w={168} h={14} color={P.skeleton2} />
        <Skel x={88} y={56} w={100} h={10} color={P.skeleton} />
        {LINES.map((w, i) => (
          <Skel key={i} x={28} y={104 + i * 24} w={w} h={9} color={P.skeleton} />
        ))}
        {/* signature area */}
        <svg width={220} height={70} viewBox="0 0 220 70" style={{ position: "absolute", left: 30, top: 272, overflow: "visible" }}>
          <path
            d={SIGNATURE}
            fill="none"
            stroke={P.fg}
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - sig}
            opacity={sig > 0.01 ? 1 : 0}
          />
        </svg>
        <div style={{ position: "absolute", left: 28, top: 346, width: 210, height: 0, borderTop: `2px dashed ${P.border}` }} />
        <Skel x={28} y={360} w={80} h={8} color={P.skeleton} />
        <div style={{ position: "absolute", left: 254, top: 326, width: 78, height: 44, borderRadius: 12, background: P.muted }} />
        {/* stamp */}
        <div
          style={{
            position: "absolute",
            left: DOC_W - 58,
            top: -22,
            width: 76,
            height: 76,
            borderRadius: 38,
            background: P.success,
            border: `5px solid ${P.card}`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            scale: String(stamp),
            rotate: `${(1 - Math.min(stamp, 1)) * -25}deg`,
            opacity: Math.min(1, stamp * 2),
            boxShadow: `0 10px 24px ${alpha(P.success.length === 7 ? P.success : "#16A34A", 0.35)}`,
          }}
        >
          <DrawCheck size={38} color="#FFFFFF" stroke={3.4} progress={ramp(f, 260, 266)} />
        </div>
      </div>
      {/* OTP boxes */}
      {DIGITS.map((d, i) => {
        const t = OTP_START + i * 3;
        const p = ramp(f, t, t + 5);
        const active = filled === i && f >= OTP_START - 4 && f < OTP_START + 18;
        const border = interpolateColors(flash, [0, 1], [active ? P.primary : P.border.startsWith("#") ? P.border : "#4A3A33", P.success]);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i * 62,
              top: 422,
              width: 52,
              height: 58,
              borderRadius: 15,
              background: flash > 0 ? alpha(P.success, 0.1 * flash) : P.card,
              backgroundColor: P.card,
              boxSizing: "border-box",
              border: `2px solid ${border}`,
              boxShadow: active ? `0 0 0 4px ${alpha(P.primary, 0.14)}` : P.shadow,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              fontWeight: 800,
              color: P.fg,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div style={{ position: "absolute", inset: 0, borderRadius: 13, background: alpha(P.success, 0.12 * flash) }} />
            <span style={{ opacity: p, scale: String(0.6 + 0.4 * p), translate: `0px ${(1 - p) * 6}px` }}>{d}</span>
            {active ? (
              <div style={{ position: "absolute", left: 24, top: 15, width: 2.5, height: 28, borderRadius: 2, background: P.primary }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
