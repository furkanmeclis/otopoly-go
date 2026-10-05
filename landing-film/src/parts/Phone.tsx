/** Phone (300×620 local) with a WhatsApp-style chat; timings use the global frame. */
import type React from "react";
import { interpolateColors, spring } from "remotion";
import { alpha, ramp } from "../lib/anim";
import { FONT, type Palette } from "../theme";
import { Car } from "./Car";
import { Skel } from "./JobCard";
import { CarGlyph, ChevronLeft, DoubleTick, Send, Sparkles, Video } from "./icons";

export const PHONE_W = 300;
export const PHONE_H = 620;

const TypingDots: React.FC<{ P: Palette; f: number }> = ({ P, f }) => (
  <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
    {[0, 1, 2].map((i) => {
      const w = 0.5 - 0.5 * Math.cos((f - 178) * 0.42 - i * 0.9);
      return (
        <div
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            background: P.name === "dark" ? "#CFE9DA" : "#2E6B3E",
            opacity: 0.35 + 0.5 * w,
            translate: `0px ${-3 * w}px`,
          }}
        />
      );
    })}
  </div>
);

export const Phone: React.FC<{ P: Palette; f: number; fps: number }> = ({ P, f, fps }) => {
  const typing = ramp(f, 178, 183) * (1 - ramp(f, 191, 195));
  const bubble = ramp(f, 192, 203);
  const tick = interpolateColors(f, [203, 207], [P.text2, P.tickBlue]);
  const badge = f < 197 ? 0 : spring({ frame: f - 197, fps, config: { damping: 13, stiffness: 160, mass: 0.7 } });
  const dark = P.name === "dark";

  return (
    <div style={{ position: "relative", width: PHONE_W, height: PHONE_H }}>
      {/* body */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 54,
          background: P.phoneFrame,
          boxShadow: `0 0 0 1.5px ${P.phoneRing}, inset 0 0 0 2px rgba(255,255,255,0.08), ${P.shadowLift}`,
        }}
      />
      {/* screen */}
      <div
        style={{
          position: "absolute",
          left: 10,
          top: 10,
          width: PHONE_W - 20,
          height: PHONE_H - 20,
          borderRadius: 45,
          background: P.card,
          overflow: "hidden",
          fontFamily: FONT,
        }}
      >
        {/* status bar */}
        <div style={{ position: "absolute", left: 30, top: 17, fontSize: 13, fontWeight: 700, color: P.fg, fontVariantNumeric: "tabular-nums" }}>
          14:32
        </div>
        <div style={{ position: "absolute", left: 95, top: 11, width: 90, height: 26, borderRadius: 13, background: "#0B0807" }} />
        <div style={{ position: "absolute", left: 210, top: 21, display: "flex", gap: 2, alignItems: "flex-end" }}>
          {[5, 7, 9, 11].map((h) => (
            <div key={h} style={{ width: 3, height: h, borderRadius: 1, background: P.fg }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: 230, top: 20, width: 24, height: 12, borderRadius: 4, border: `1.5px solid ${alpha(dark ? "#FBF5F2" : "#241C18", 0.5)}`, boxSizing: "border-box", padding: 1.5 }}>
          <div style={{ width: "72%", height: "100%", borderRadius: 2, background: P.fg }} />
        </div>
        {/* chat header */}
        <div style={{ position: "absolute", left: 0, top: 46, width: 280, height: 62, background: P.muted, borderBottom: `1px solid ${P.border}` }}>
          <ChevronLeft size={22} color={P.text2} stroke={2.4} style={{ position: "absolute", left: 8, top: 20 }} />
          <div style={{ position: "absolute", left: 34, top: 12, width: 38, height: 38, borderRadius: 19, background: P.wa, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CarGlyph size={22} color="#FFFFFF" stroke={2.2} />
          </div>
          <Skel x={84} y={18} w={96} h={10} color={P.skeleton2} />
          <Skel x={84} y={35} w={56} h={8} color={P.skeleton} />
          <Video size={22} color={P.text2} stroke={2} style={{ position: "absolute", left: 210, top: 20 }} />
          <div style={{ position: "absolute", left: 250, top: 20, display: "flex", flexDirection: "column", gap: 3.5 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 4, height: 4, borderRadius: 2, background: P.text2 }} />
            ))}
          </div>
        </div>
        {/* chat area */}
        <Skel x={105} y={122} w={70} h={16} color={P.skeleton} />
        <div
          style={{
            position: "absolute",
            left: 12,
            top: 152,
            width: 70,
            height: 40,
            borderRadius: 20,
            borderTopLeftRadius: 6,
            background: P.bubble,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: typing,
            scale: String(0.85 + 0.15 * typing),
            transformOrigin: "0% 0%",
          }}
        >
          <TypingDots P={P} f={f} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 12,
            top: 152,
            width: 222,
            borderRadius: 18,
            borderTopLeftRadius: 6,
            background: P.bubble,
            padding: 8,
            boxSizing: "border-box",
            opacity: bubble,
            scale: String(0.9 + 0.1 * bubble),
            translate: `0px ${(1 - bubble) * 8}px`,
            transformOrigin: "0% 0%",
            boxShadow: dark ? "none" : "0 1px 1px rgba(36,28,24,0.06)",
          }}
        >
          <div
            style={{
              position: "relative",
              height: 112,
              borderRadius: 12,
              overflow: "hidden",
              background: dark
                ? "linear-gradient(160deg, #3A2D27 0%, #2A201C 100%)"
                : "linear-gradient(160deg, #FFF3EC 0%, #F7E3D8 100%)",
            }}
          >
            <div style={{ position: "absolute", left: 20, top: 26, scale: "0.4", transformOrigin: "0 0" }}>
              <Car P={P} wheelAngle={0} pitch={0} />
            </div>
            <div style={{ position: "absolute", left: 18, top: 90, width: 170, height: 6, borderRadius: 3, background: alpha("#000000", dark ? 0.35 : 0.08) }} />
            <Sparkles size={20} color={P.primary} stroke={2} style={{ position: "absolute", right: 12, top: 10 }} />
          </div>
          <div style={{ position: "relative", height: 70 }}>
            <Skel x={4} y={12} w={186} h={9} color={P.bubbleLine} />
            <Skel x={4} y={29} w={160} h={9} color={P.bubbleLine} />
            <Skel x={4} y={46} w={104} h={9} color={P.bubbleLine} />
            <div
              style={{
                position: "absolute",
                right: 2,
                bottom: -2,
                display: "flex",
                alignItems: "center",
                gap: 3,
                fontSize: 11,
                fontWeight: 600,
                color: P.text2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              14:32
              <DoubleTick size={17} color={tick} stroke={2.2} />
            </div>
          </div>
        </div>
        {/* composer */}
        <div style={{ position: "absolute", left: 12, top: 534, width: 210, height: 40, borderRadius: 20, background: P.muted, border: `1px solid ${P.border}`, boxSizing: "border-box" }}>
          <Skel x={18} y={15} w={90} h={8} color={P.skeleton} />
        </div>
        <div style={{ position: "absolute", left: 228, top: 534, width: 40, height: 40, borderRadius: 20, background: P.wa, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Send size={18} color="#FFFFFF" stroke={2.2} />
        </div>
        <div style={{ position: "absolute", left: 85, top: 586, width: 110, height: 5, borderRadius: 3, background: alpha(dark ? "#FBF5F2" : "#241C18", 0.3) }} />
      </div>
      {/* notification badge */}
      <div
        style={{
          position: "absolute",
          left: PHONE_W - 30,
          top: -14,
          width: 44,
          height: 44,
          borderRadius: 22,
          background: P.primary,
          border: `4px solid ${P.bg}`,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 18,
          scale: String(badge),
          opacity: Math.min(1, badge * 2),
          boxShadow: `0 6px 16px ${alpha(P.primary, 0.35)}`,
        }}
      >
        1
      </div>
    </div>
  );
};
