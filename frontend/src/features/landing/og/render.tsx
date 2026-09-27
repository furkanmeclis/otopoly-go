import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import {
  wordmarkAccentEvenoddIndex,
  wordmarkAccentPaths,
  wordmarkGlyphPaths,
  wordmarkViewBox,
} from "@/components/brand/artwork";
import { brand } from "@/config/brand";
import { site } from "@/config/site";
import { ogSize } from "@/features/landing/og/meta";

const FONT_DIR = join(process.cwd(), "src/features/landing/og/fonts");

type OgLocale = "tr" | "en";

const COPY = {
  tr: {
    eyebrow: "OTO YIKAMA · DETAILING · OTO BAKIM",
    lines: [
      "Aracın kabulünden",
      "teslimine, tüm",
      "işletmeniz",
      "tek ekranda.",
    ],
    chips: ["İş emirleri", "WhatsApp", "OTP'li sözleşme", "Cari & kasa"],
    trial: "14 gün ücretsiz",
    boardTitle: "Operasyon · Bugün",
    columns: ["İşlemde", "Hazır", "Teslim"],
    services: ["Seramik kaplama", "İç temizlik", "İç-dış yıkama", "Pasta cila"],
    whatsappFrom: "WhatsApp · İşletmeniz",
    whatsappBody: "35 EGE 35 plakalı aracınız teslime hazır.",
  },
  en: {
    eyebrow: "CAR WASH · DETAILING · CAR CARE",
    lines: [
      "From drop-off to",
      "hand-over, your",
      "whole shop on",
      "one screen.",
    ],
    chips: ["Job orders", "WhatsApp", "OTP contracts", "Accounts & cash"],
    trial: "14 days free",
    boardTitle: "Operations · Today",
    columns: ["In progress", "Ready", "Delivered"],
    services: ["Ceramic coating", "Interior clean", "Full wash", "Polish"],
    whatsappFrom: "WhatsApp · Your shop",
    whatsappBody: "Your car 35 EGE 35 is ready for pick-up.",
  },
} as const;

function board(locale: OgLocale) {
  const c = COPY[locale];
  return [
    {
      title: c.columns[0],
      dot: "#FBBF24",
      cards: [
        ["34 TKO 34", c.services[0]],
        ["06 BRK 061", c.services[1]],
      ],
    },
    {
      title: c.columns[1],
      dot: "#34D399",
      cards: [["35 EGE 35", c.services[2]]],
    },
    {
      title: c.columns[2],
      dot: "#38BDF8",
      cards: [["16 BRS 116", c.services[3]]],
    },
  ];
}

/**
 * Social share card (1200×630). Rendered once at build time: the route files
 * that use it have no dynamic inputs, so Next.js prerenders them to static PNGs.
 * Fonts are bundled locally so Turkish glyphs (ş, ğ, ı) render correctly offline.
 */
export async function renderOgImage(locale: OgLocale = "tr") {
  const c = COPY[locale];
  const [display, body] = await Promise.all([
    readFile(join(FONT_DIR, "Outfit-Bold.ttf")),
    readFile(join(FONT_DIR, "PlusJakartaSans-Medium.ttf")),
  ]);
  const host = new URL(site.url).host;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: brand.colors.ink,
        color: "#fff",
        fontFamily: "Jakarta",
        overflow: "hidden",
      }}
    >
      {/* Warm glows echoing the hero shader (full-bleed layers avoid clipped edges). */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundImage:
            "radial-gradient(circle at 82% 18%, rgba(234,110,67,0.9) 0%, rgba(140,59,32,0.5) 28%, rgba(26,20,18,0) 58%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundImage:
            "radial-gradient(circle at 0% 100%, rgba(242,176,143,0.28) 0%, rgba(26,20,18,0) 45%)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 0 52px 72px",
          width: 668,
        }}
      >
        <svg
          width="230"
          height={Math.round((230 * 309) / 1435)}
          viewBox={wordmarkViewBox}
        >
          {wordmarkGlyphPaths.map((d) => (
            <path key={d.slice(0, 16)} fill="#fff" d={d} />
          ))}
          {wordmarkAccentPaths.map((d, i) => (
            <path
              key={d.slice(0, 16)}
              fill={brand.colors.primary}
              fillRule={
                i === wordmarkAccentEvenoddIndex ? "evenodd" : undefined
              }
              d={d}
            />
          ))}
        </svg>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 20,
              color: "#F2B08F",
              letterSpacing: 1,
            }}
          >
            {c.eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 18,
              fontFamily: "Outfit",
              fontSize: 52,
              lineHeight: 1.06,
              letterSpacing: -1.5,
            }}
          >
            <span>{c.lines[0]}</span>
            <span>{c.lines[1]}</span>
            <span style={{ color: "#F59A6F" }}>{c.lines[2]}</span>
            <span style={{ color: "#F59A6F" }}>{c.lines[3]}</span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 28,
            }}
          >
            {c.chips.map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  fontSize: 17,
                  color: "rgba(255,255,255,0.88)",
                }}
              >
                {chip}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 20,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "8px 18px",
              borderRadius: 999,
              background: brand.colors.primary,
              color: "#fff",
              fontFamily: "Outfit",
              fontSize: 20,
            }}
          >
            {c.trial}
          </div>
          {host}
        </div>
      </div>

      {/* Mini operations board. */}
      <div
        style={{
          position: "absolute",
          right: 56,
          top: 150,
          width: 440,
          display: "flex",
          flexDirection: "column",
          borderRadius: 24,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(255,255,255,0.08)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            fontSize: 15,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 99,
                  background: "rgba(255,255,255,0.25)",
                }}
              />
            ))}
          </div>
          {c.boardTitle}
        </div>
        <div style={{ display: "flex", gap: 10, padding: 14 }}>
          {board(locale).map((col) => (
            <div
              key={col.title}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flex: 1,
                padding: 8,
                borderRadius: 14,
                background: "rgba(0,0,0,0.2)",
                minHeight: 230,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 14,
                  color: "rgba(255,255,255,0.85)",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: col.dot,
                  }}
                />
                {col.title}
              </div>
              {col.cards.map(([plate, service]) => (
                <div
                  key={plate}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: 8,
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignSelf: "flex-start",
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: "#fff",
                      color: "#171717",
                      fontSize: 12,
                    }}
                  >
                    {plate}
                  </div>
                  <div style={{ display: "flex", fontSize: 13 }}>{service}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 36,
          bottom: 64,
          width: 300,
          display: "flex",
          flexDirection: "column",
          padding: "12px 16px",
          borderRadius: 18,
          borderBottomRightRadius: 4,
          background: "#DCF8C6",
          color: "#171717",
          boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ display: "flex", fontSize: 13, color: "#047857" }}>
          {c.whatsappFrom}
        </div>
        <div style={{ display: "flex", fontSize: 16, marginTop: 4 }}>
          {c.whatsappBody}
        </div>
      </div>
    </div>,
    {
      ...ogSize,
      fonts: [
        { name: "Outfit", data: display, weight: 700, style: "normal" },
        { name: "Jakarta", data: body, weight: 500, style: "normal" },
      ],
    },
  );
}
