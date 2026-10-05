/**
 * One continuous camera move in six chapters (see tmp/beta-landing-spec.md):
 *   1 Arrival 0–49 · 2 Work order 50–109 · 3 Board 110–169
 *   4 Customer notified 170–219 · 5 Signed 220–264 · 6 Day closes 265–299
 *
 * Everything is authored in a logical 800×760 "stage" that is scaled into the
 * non-reserved part of the frame, so landscape and portrait share all code.
 * The film contains no words: only digits, the plate, icons and skeleton bars.
 */
import type React from "react";
import { AbsoluteFill, Easing, interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, EASE_IN_OUT, alpha, bump, lerp, lerpPt, ramp, type Pt } from "./lib/anim";
import { STAGE_H, STAGE_W, stageBox, type Layout, type ThemeName } from "./lib/stage";
import { PALETTES } from "./theme";
import { Background } from "./parts/Background";
import { Board, CARD_TOP, COL_GAP } from "./parts/Board";
import { CAR_H, CAR_PLATE_W, CAR_W, Car } from "./parts/Car";
import { Contract, DOC_W } from "./parts/Contract";
import {
  CARD_CAR_ANCHOR,
  CARD_H,
  CARD_PLATE_ANCHOR,
  CARD_PLATE_SCALE,
  CARD_W,
  JobCard,
} from "./parts/JobCard";
import { Mark } from "./parts/Mark";
import { Phone, PHONE_H, PHONE_W } from "./parts/Phone";
import { PLATE_H, PLATE_W, Plate } from "./parts/Plate";
import { Report, REPORT_H, REPORT_W } from "./parts/Report";

export type FilmProps = { theme: ThemeName; layout: Layout };

/** Car parked in chapter 1, plate hover point above it. */
const CAR_PARK: Pt = { x: 400, y: 430 };
const CAR_START_X = 610;
const PLATE_FLOAT: Pt = { x: 400, y: 268 };
/** Pull-back curve: gentle start, most of the scale change early so the board fits the frame before it appears. */
const PULL = Easing.bezier(0.4, 0, 0.2, 1);

export const ScrollFilm: React.FC<FilmProps> = ({ theme, layout }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const P = PALETTES[theme];
  const box = stageBox(layout);

  // ---------- world camera (board space → stage) ----------
  const zoom = ramp(f, 109, 126, 0, 1, PULL);
  const dim = ramp(f, 170, 190, 0, 1, EASE_IN_OUT);
  // board view: 0.49 → 780 units wide (~97% of the stage), centred; dimmed view a bit smaller
  const ws = lerp(lerp(1, 0.49, zoom), 0.43, dim);
  const tx = lerp(lerp(160, 400 - 780 * 0.49, zoom), 380 - 780 * 0.43, dim);
  const ty = lerp(lerp(78, 380 - 430 * 0.49, zoom), 370 - 430 * 0.43, dim);
  const worldOp = lerp(1, 0.3, dim) * (1 - ramp(f, 220, 236));
  // columns appear only once the board fits inside the frame (no crop during the pull-back)
  const boardReveal = ramp(f, 118, 132, 0, 1, EASE_IN_OUT);

  // ---------- our job card inside the world ----------
  const move = ramp(f, 132, 154, 0, 1, EASE_IN_OUT);
  const slot = { x: COL_GAP * move, y: CARD_TOP - 70 * Math.sin(Math.PI * move) };
  const lifted = ramp(f, 126, 134) * (1 - ramp(f, 154, 162, 0, 1, EASE_IN_OUT));
  const L = 1 + 0.05 * lifted;
  const ring = ramp(f, 122, 132) * (1 - ramp(f, 172, 190));
  const cardToStage = (lx: number, ly: number): Pt => ({
    x: tx + ws * (slot.x + CARD_W / 2 + L * (lx - CARD_W / 2)),
    y: ty + ws * (slot.y + CARD_H / 2 + L * (ly - CARD_H / 2)),
  });
  const m1 = ramp(f, 50, 66, 0, 1, EASE_IN_OUT);
  const m2 = ramp(f, 64, 84);
  const surface = {
    x: lerp(140, 0, m1),
    y: lerp(90, 0, m1),
    w: lerp(PLATE_W, CARD_W, m1),
    h: lerp(lerp(PLATE_H, 112, m1), CARD_H, m2),
  };

  // ---------- car ----------
  const drive = ramp(f, 0, 30);
  const carX0 = lerp(CAR_START_X, CAR_PARK.x, drive);
  const wheelAngle = (-(CAR_START_X - carX0) / 32) * (180 / Math.PI);
  const pitch = -1.1 * (ramp(f, 14, 27, 0, 1, EASE_IN_OUT) - ramp(f, 27, 44, 0, 1, EASE_IN_OUT));
  const toCard = ramp(f, 50, 72, 0, 1, EASE_IN_OUT);
  const car = lerpPt({ x: carX0, y: CAR_PARK.y }, cardToStage(CARD_CAR_ANCHOR.x, CARD_CAR_ANCHOR.y), toCard);
  const carS = lerp(1, 0.3 * ws * L, toCard);

  // ---------- plate ----------
  const th = (pitch * Math.PI) / 180;
  const v = { x: 185, y: -22 };
  const plateOnCar: Pt = {
    x: car.x + carS * (v.x * Math.cos(th) - v.y * Math.sin(th)),
    y: car.y + carS * (41.5 + v.x * Math.sin(th) + v.y * Math.cos(th)),
  };
  const lift = ramp(f, 37, 49, 0, 1, EASE_IN_OUT);
  const toChip = ramp(f, 50, 66, 0, 1, EASE_IN_OUT);
  const plate = lerpPt(lerpPt(plateOnCar, PLATE_FLOAT, lift), cardToStage(CARD_PLATE_ANCHOR.x, CARD_PLATE_ANCHOR.y), toChip);
  const plateS = lerp(lerp((CAR_PLATE_W / PLATE_W) * carS, 1, lift), CARD_PLATE_SCALE * ws * L, toChip);
  const plateFloat = lift * (1 - toChip);

  // ---------- scan reticle (chapter 1) ----------
  const reticle = bump(f, 27, 32, 46, 52);
  const scan = ramp(f, 31, 42, 0, 1, EASE_IN_OUT);
  const scanOp = bump(f, 31, 33, 41, 44);
  const recog = interpolateColors(f, [41, 45], [P.primary, P.success]);
  const rw = PLATE_W * plateS + 48;
  const rh = PLATE_H * plateS + 40;

  // ---------- phone ----------
  const rise = ramp(f, 170, 192);
  const turn = ramp(f, 218, 234, 0, 1, EASE_IN_OUT);
  const gather = ramp(f, 264, 274, 0, 1, EASE_IN_OUT);
  const phone = {
    x: lerp(lerp(400, 604, turn), 400, gather),
    y: lerp(lerp(1180, 384, rise), 380, gather),
    s: lerp(lerp(1, 0.82, turn), 0.5, gather),
    ry: -18 * turn * (1 - gather),
    op: ramp(f, 170, 178) * (1 - ramp(f, 264, 273, 0, 1, EASE_IN_OUT)),
  };

  // ---------- contract ----------
  const docIn = ramp(f, 226, 242);
  const doc = {
    x: lerp(30 + DOC_W / 2, 400, gather),
    y: lerp(370 + (1 - docIn) * 60, 380, gather),
    s: lerp(1, 0.55, gather),
    op: docIn * (1 - ramp(f, 264, 273, 0, 1, EASE_IN_OUT)),
  };

  // ---------- report + mark ----------
  const rIn = ramp(f, 272, 284);
  const rOut = ramp(f, 287, 294, 0, 1, EASE_IN_OUT);
  const mIn = ramp(f, 289, 298, 0, 1, EASE);

  const layer = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
    position: "absolute",
    left: x - w / 2,
    top: y - h / 2,
    width: w,
    height: h,
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Background P={P} layout={layout} frame={f} box={box} />
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: STAGE_W,
          height: STAGE_H,
          scale: String(box.s),
          transformOrigin: "0 0",
        }}
      >
        {/* world: board + job card (chapters 2–4) */}
        {f >= 49 && worldOp > 0.001 ? (
          <div
            style={{
              position: "absolute",
              left: tx,
              top: ty,
              scale: String(ws),
              transformOrigin: "0 0",
              opacity: worldOp,
            }}
          >
            {boardReveal > 0 ? <Board P={P} f={f} reveal={boardReveal} /> : null}
            <div
              style={{
                position: "absolute",
                left: slot.x,
                top: slot.y,
                width: CARD_W,
                height: CARD_H,
                scale: String(L),
              }}
            >
              <JobCard
                P={P}
                f={f}
                surface={surface}
                radius={lerp(8, 24, m1)}
                surfaceOpacity={ramp(f, 49, 55)}
                ring={ring}
                lift={lifted}
              />
            </div>
          </div>
        ) : null}

        {/* car */}
        {worldOp > 0.001 ? (
          <div
            style={{
              ...layer(car.x, car.y, CAR_W, CAR_H),
              scale: String(carS),
              opacity: f < 110 ? 1 : worldOp,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 30,
                top: 142,
                width: 380,
                height: 30,
                borderRadius: "50%",
                background: `radial-gradient(ellipse at 50% 50%, ${P.car.groundShadow} 0%, rgba(0,0,0,0) 70%)`,
                opacity: 1 - 0.75 * toCard,
              }}
            />
            <Car P={P} wheelAngle={wheelAngle} pitch={pitch} />
          </div>
        ) : null}

        {/* plate (lifts off the car, becomes the card's header chip) */}
        {worldOp > 0.001 ? (
          <div
            style={{
              ...layer(plate.x, plate.y, PLATE_W, PLATE_H),
              scale: String(plateS),
              rotate: `${pitch * (1 - lift)}deg`,
              opacity: f < 110 ? 1 : worldOp,
            }}
          >
            <Plate
              shadow={`0 ${18 * plateFloat}px ${36 * plateFloat}px -${8 * plateFloat}px rgba(0,0,0,${(P.name === "dark" ? 0.55 : 0.22) * plateFloat}), 0 0 ${40 * plateFloat}px ${alpha(P.primary, 0.25 * plateFloat)}`}
            />
          </div>
        ) : null}

        {/* scan reticle */}
        {reticle > 0.001 ? (
          <div style={{ ...layer(plate.x, plate.y, rw, rh), opacity: reticle }}>
            {[
              { left: 0, top: 0, bl: true, bt: true },
              { right: 0, top: 0, br: true, bt: true },
              { left: 0, bottom: 0, bl: true, bb: true },
              { right: 0, bottom: 0, br: true, bb: true },
            ].map((c, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: c.left,
                  right: c.right,
                  top: c.top,
                  bottom: c.bottom,
                  width: Math.min(22, rw / 3),
                  height: Math.min(22, rh / 3),
                  borderColor: recog,
                  borderStyle: "solid",
                  borderWidth: 0,
                  borderLeftWidth: c.bl ? 3 : 0,
                  borderRightWidth: c.br ? 3 : 0,
                  borderTopWidth: c.bt ? 3 : 0,
                  borderBottomWidth: c.bb ? 3 : 0,
                  borderTopLeftRadius: c.bl && c.bt ? 8 : 0,
                  borderTopRightRadius: c.br && c.bt ? 8 : 0,
                  borderBottomLeftRadius: c.bl && c.bb ? 8 : 0,
                  borderBottomRightRadius: c.br && c.bb ? 8 : 0,
                }}
              />
            ))}
            <div
              style={{
                position: "absolute",
                left: 6,
                right: 6,
                top: 4 + scan * (rh - 8) - 28,
                height: 28,
                opacity: scanOp,
                background: `linear-gradient(180deg, ${alpha(P.primary, 0)} 0%, ${alpha(P.primary, 0.22)} 100%)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 2,
                right: 2,
                top: 3 + scan * (rh - 8),
                height: 2.5,
                borderRadius: 2,
                opacity: scanOp,
                background: P.primary,
                boxShadow: `0 0 12px ${alpha(P.primary, 0.8)}`,
              }}
            />
          </div>
        ) : null}

        {/* contract + OTP (chapter 5) */}
        {doc.op > 0.001 ? (
          <div style={{ ...layer(doc.x, doc.y, DOC_W, 480), scale: String(doc.s), opacity: doc.op }}>
            <Contract P={P} f={f} fps={fps} />
          </div>
        ) : null}

        {/* phone (chapters 4–5) */}
        {phone.op > 0.001 ? (
          <div
            style={{
              ...layer(phone.x, phone.y, PHONE_W, PHONE_H),
              opacity: phone.op,
              transform: `perspective(1600px) scale(${phone.s}) rotateY(${phone.ry}deg)`,
            }}
          >
            <Phone P={P} f={f} fps={fps} />
          </div>
        ) : null}

        {/* report (chapter 6) */}
        {rIn > 0.001 && rOut < 0.999 ? (
          <div
            style={{
              ...layer(400, 380, REPORT_W, REPORT_H),
              opacity: rIn * (1 - rOut),
              scale: String(lerp(0.86, 1, rIn) * (1 - 0.1 * rOut)),
              filter: rOut > 0 ? `blur(${8 * rOut}px)` : undefined,
            }}
          >
            <Report P={P} f={f} />
          </div>
        ) : null}

        {/* Otopoly mark — the resting end state */}
        {mIn > 0.001 ? (
          <>
            <div
              style={{
                ...layer(400, 380, 640, 640),
                opacity: mIn,
                borderRadius: "50%",
                background: `radial-gradient(circle at 50% 50%, ${alpha(P.primary, P.name === "dark" ? 0.26 : 0.18)} 0%, ${alpha(P.primary, 0)} 62%)`,
              }}
            />
            <div
              style={{
                ...layer(400, 380, 340, (340 * 524) / 880),
                opacity: mIn,
                scale: String(lerp(0.72, 1, mIn)),
              }}
            >
              <Mark width={340} fg={P.fg} primary={P.primary} />
            </div>
          </>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
