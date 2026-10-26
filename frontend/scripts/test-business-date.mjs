// Smoke test of the business-day helpers (Europe/Istanbul) under several
// process time zones. Run: node scripts/test-business-date.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);

if (process.argv[2] !== "--child") {
  for (const tz of [
    "UTC",
    "Europe/Istanbul",
    "America/Los_Angeles",
    "Pacific/Kiritimati",
  ]) {
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", self, "--child"],
      {
        env: { ...process.env, TZ: tz },
        stdio: "inherit",
      },
    );
    console.log(`business-date ok (TZ=${tz})`);
  }
  process.exit(0);
}

const d = await import("../src/lib/utils/business-date.ts");

// 26.10.2026 22:38 UTC is 27.10.2026 01:38 in Türkiye (the owner's report).
const lateNight = new Date("2026-10-26T22:38:00Z");
assert.equal(d.businessToday(lateNight), "2026-10-27");
assert.equal(d.businessDayOf("2026-10-26T22:38:00Z"), "2026-10-27");
assert.equal(d.businessDayOf("2026-10-27"), "2026-10-27");
assert.equal(
  d.businessMonthStart(new Date("2026-10-31T22:30:00Z")),
  "2026-11-01",
);
assert.equal(d.shiftDay("2026-10-27", -30), "2026-09-27");
assert.equal(d.shiftDay("2026-12-31", 1), "2027-01-01");
assert.equal(d.daysBetween("2026-10-01", "2026-10-27"), 26);
assert.equal(d.businessDayStartISO("2026-10-27"), "2026-10-26T21:00:00.000Z");
assert.equal(
  d.businessDateTimeISO("2026-10-27", "01:38"),
  lateNight.toISOString(),
);
const wall = d.businessWallClock(lateNight);
assert.deepEqual(
  [
    wall.getFullYear(),
    wall.getMonth() + 1,
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
  ],
  [2026, 10, 27, 1, 38],
);
