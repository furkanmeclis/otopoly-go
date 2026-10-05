/** Kanban board in world units: three columns 540 apart, cards start at y=76. */
import type React from "react";
import { EASE_IN_OUT, lerp, ramp } from "../lib/anim";
import { FONT, type Palette } from "../theme";
import { CARD_W, GhostCard } from "./JobCard";
import { CircleCheck, Clock, Key } from "./icons";

export const COL_GAP = 540;
export const CARD_TOP = 76;
const GHOST_H = 150;
/** Panel height: tallest column (card + two ghosts) plus padding. */
export const PANEL_H = 900;

const Count: React.FC<{ P: Palette; from: number; to: number; p: number }> = ({
  P,
  from,
  to,
  p,
}) => (
  <div
    style={{
      position: "absolute",
      left: 78,
      top: 11,
      width: 56,
      height: 36,
      borderRadius: 18,
      background: P.card,
      border: `1px solid ${P.border}`,
      boxSizing: "border-box",
      overflow: "hidden",
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 22,
      color: P.fg,
      fontVariantNumeric: "tabular-nums",
    }}
  >
    {[from, to].map((n, i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: i === 0 ? 1 - p : p,
          translate: `0px ${i === 0 ? -p * 22 : (1 - p) * 22}px`,
        }}
      >
        {n}
      </div>
    ))}
  </div>
);

export const Board: React.FC<{ P: Palette; f: number; reveal: number }> = ({
  P,
  f,
  reveal,
}) => {
  const cols = [
    { color: P.amber, Icon: Clock, from: 3, to: 2 },
    { color: P.success, Icon: CircleCheck, from: 2, to: 3 },
    { color: P.slate, Icon: Key, from: 3, to: 3 },
  ];
  const countP = ramp(f, 152, 160);
  const ghosts: { col: number; y: number; seed: number }[] = [
    { col: 0, y: lerp(540, CARD_TOP, ramp(f, 146, 164, 0, 1, EASE_IN_OUT)), seed: 0 },
    { col: 0, y: lerp(706, 242, ramp(f, 149, 167, 0, 1, EASE_IN_OUT)), seed: 1 },
    { col: 1, y: lerp(CARD_TOP, 540, ramp(f, 128, 146, 0, 1, EASE_IN_OUT)), seed: 2 },
    { col: 1, y: lerp(242, 706, ramp(f, 131, 149, 0, 1, EASE_IN_OUT)), seed: 5 },
    { col: 2, y: CARD_TOP, seed: 3 },
    { col: 2, y: 242, seed: 4 },
    { col: 2, y: 408, seed: 6 },
  ];
  const panelBg = P.name === "dark" ? "rgba(255,255,255,0.025)" : "rgba(247,238,233,0.6)";

  return (
    <div style={{ position: "absolute", left: 0, top: 0, opacity: reveal }}>
      {cols.map(({ color, Icon, from, to }, i) => (
        <div key={i} style={{ position: "absolute", left: i * COL_GAP, top: 0 }}>
          <div
            style={{
              position: "absolute",
              left: -16,
              top: -20,
              width: CARD_W + 32,
              height: PANEL_H,
              borderRadius: 32,
              background: panelBg,
              border: `1px solid ${P.border}`,
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 4,
              top: 22,
              width: 14,
              height: 14,
              borderRadius: 7,
              background: color,
              boxShadow: `0 0 0 5px ${color}22`,
            }}
          />
          <Icon size={32} color={color} stroke={2.2} style={{ position: "absolute", left: 32, top: 13 }} />
          <Count P={P} from={from} to={to} p={from === to ? 0 : countP} />
        </div>
      ))}
      {ghosts.map(({ col, y, seed }) => (
        <div
          key={seed}
          style={{
            position: "absolute",
            left: col * COL_GAP,
            top: y,
            width: CARD_W,
            height: GHOST_H,
          }}
        >
          <GhostCard P={P} dot={cols[col].color} seed={seed} />
        </div>
      ))}
    </div>
  );
};
