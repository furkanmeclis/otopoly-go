/**
 * The work-order card (480×448 local units). The car badge and the plate chip are
 * drawn by the stage on top of this card (they travel in from chapter 1), so this
 * component only renders the card surface and its own contents.
 */
import type React from "react";
import { interpolateColors } from "remotion";
import { alpha, ramp } from "../lib/anim";
import type { Palette } from "../theme";
import { DrawCheck, Droplet, Shield, Sparkles } from "./icons";

export const CARD_W = 480;
export const CARD_H = 448;
/** Card-local anchor points used by the stage to place the car and the plate. */
export const CARD_CAR_TILE = { x: 20, y: 20, w: 150, h: 72 };
export const CARD_CAR_ANCHOR = { x: 95, y: 54 };
export const CARD_PLATE_ANCHOR = { x: 268, y: 56 };
export const CARD_PLATE_SCALE = 0.8;

export type Rect = { x: number; y: number; w: number; h: number };

const ROWS = [
  { Icon: Droplet, a: 176, b: 96 },
  { Icon: Sparkles, a: 138, b: 120 },
  { Icon: Shield, a: 158, b: 82 },
];

export const Skel: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  r?: number;
  style?: React.CSSProperties;
}> = ({ x, y, w, h, color, r, style }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      borderRadius: r ?? h / 2,
      background: color,
      ...style,
    }}
  />
);

export const JobCard: React.FC<{
  P: Palette;
  f: number;
  surface: Rect;
  radius: number;
  surfaceOpacity: number;
  ring: number;
  lift: number;
}> = ({ P, f, surface, radius, surfaceOpacity, ring, lift }) => {
  const tile = ramp(f, 58, 70);
  const dotPop = ramp(f, 62, 72);
  const dotColor = interpolateColors(f, [154, 160], [P.amber, P.success]);
  const footer = ramp(f, 90, 102);
  const divider = ramp(f, 66, 80);

  const inset = `inset(${surface.y}px ${CARD_W - surface.x - surface.w}px ${CARD_H - surface.y - surface.h}px ${surface.x}px round ${radius}px)`;

  const ringShadow =
    ring > 0
      ? `, 0 0 0 ${2 * ring}px ${P.primary}, 0 0 ${48 * ring}px ${alpha(P.primary, 0.35 * ring)}`
      : "";

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: CARD_W, height: CARD_H }}>
      {/* surface */}
      <div
        style={{
          position: "absolute",
          left: surface.x,
          top: surface.y,
          width: surface.w,
          height: surface.h,
          borderRadius: radius,
          background: P.card,
          backgroundImage: P.sheen,
          border: `1px solid ${P.border}`,
          boxSizing: "border-box",
          opacity: surfaceOpacity,
          boxShadow: `${lift > 0.01 ? P.shadowLift : P.shadow}${ringShadow}`,
        }}
      />
      {/* contents, revealed by the unfolding surface */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: inset,
          opacity: surfaceOpacity,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: CARD_CAR_TILE.x,
            top: CARD_CAR_TILE.y,
            width: CARD_CAR_TILE.w,
            height: CARD_CAR_TILE.h,
            borderRadius: 18,
            background: P.muted,
            opacity: tile,
          }}
        />
        {/* header extras: a short skeleton pill + status dot */}
        <Skel x={366} y={47} w={52} h={18} color={P.skeleton} style={{ opacity: tile }} />
        <div
          style={{
            position: "absolute",
            left: 436,
            top: 42,
            width: 28,
            height: 28,
            borderRadius: 14,
            scale: String(0.4 + 0.6 * dotPop),
            opacity: dotPop,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: dotColor,
              opacity: 0.2,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 7,
              top: 7,
              width: 14,
              height: 14,
              borderRadius: 7,
              background: dotColor,
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: 20,
            top: 112,
            width: 440 * divider,
            height: 1,
            background: P.border,
          }}
        />
        {ROWS.map(({ Icon, a, b }, i) => {
          const start = 72 + i * 8;
          const p = ramp(f, start, start + 12);
          const tick = ramp(f, 96 + i * 4, 103 + i * 4);
          const top = 128 + i * 76;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                top,
                width: CARD_W,
                height: 64,
                opacity: p,
                translate: `0px ${(1 - p) * 14}px`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 20,
                  top: 8,
                  width: 48,
                  height: 48,
                  borderRadius: 15,
                  background: alpha(P.primary, P.name === "dark" ? 0.16 : 0.1),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={24} color={P.primary} stroke={2} />
              </div>
              <Skel x={86} y={16} w={a} h={12} color={P.skeleton2} />
              <Skel x={86} y={38} w={b} h={10} color={P.skeleton} />
              <div
                style={{
                  position: "absolute",
                  left: 428,
                  top: 17,
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  boxSizing: "border-box",
                  border: `2px solid ${tick > 0 ? P.primary : P.border}`,
                  background: tick > 0 ? alpha(P.primary, Math.min(1, tick * 1.6)) : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <DrawCheck size={22} color="#FFFFFF" stroke={3} progress={tick} />
              </div>
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: 20,
            top: 364,
            width: 440 * divider,
            height: 1,
            background: P.border,
          }}
        />
        <div style={{ opacity: footer, translate: `0px ${(1 - footer) * 12}px` }}>
          {[
            "linear-gradient(135deg, #F8B38F 0%, #EA6E43 100%)",
            "linear-gradient(135deg, #7DD3C0 0%, #2F7F86 100%)",
          ].map((g, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 20 + i * 28,
                top: 384,
                width: 42,
                height: 42,
                borderRadius: 21,
                background: g,
                boxShadow: `0 0 0 3px ${P.card}`,
              }}
            />
          ))}
          <Skel x={104} y={392} w={118} h={11} color={P.skeleton2} />
          <Skel x={104} y={410} w={70} h={8} color={P.skeleton} />
          <Skel x={380} y={392} w={80} h={26} r={13} color={P.muted} />
        </div>
      </div>
    </div>
  );
};

/** Low-contrast placeholder card for the board (480×150). */
export const GhostCard: React.FC<{ P: Palette; dot: string; seed: number }> = ({
  P,
  dot,
  seed,
}) => {
  const w1 = [250, 210, 280, 230, 196, 262, 220][seed % 7];
  const w2 = [150, 170, 120, 180, 140, 110, 160][seed % 7];
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 24,
        background: P.card,
        border: `1px solid ${P.border}`,
        boxSizing: "border-box",
        boxShadow: P.name === "dark" ? "none" : "0 1px 2px rgba(36,28,24,0.04)",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: 0.8 }}>
        <Skel x={22} y={22} w={120} h={36} r={10} color={P.muted} />
        <Skel x={156} y={34} w={70} h={12} color={P.skeleton} />
        <div
          style={{
            position: "absolute",
            left: 444,
            top: 33,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: dot,
            opacity: 0.55,
          }}
        />
        <Skel x={22} y={74} w={w1} h={12} color={P.skeleton} />
        <Skel x={22} y={96} w={w2} h={10} color={P.skeleton} />
        <div style={{ position: "absolute", left: 22, top: 114, width: 26, height: 26, borderRadius: 13, background: P.skeleton2, boxShadow: `0 0 0 3px ${P.card}` }} />
        <div style={{ position: "absolute", left: 40, top: 114, width: 26, height: 26, borderRadius: 13, background: P.skeleton, boxShadow: `0 0 0 3px ${P.card}` }} />
      </div>
    </div>
  );
};

