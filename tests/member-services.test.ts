import assert from "node:assert/strict";
import test from "node:test";
import { MEMBERSHIP_WARNING_DAYS, membershipNotice } from "../lib/member-services";

test("avisa siete días antes del vencimiento y no antes", () => {
  const now = Date.UTC(2026, 8, 8, 12);
  assert.equal(MEMBERSHIP_WARNING_DAYS, 7);
  assert.equal(membershipNotice(new Date(now + 8 * 86_400_000).toISOString(), now), null);
  assert.match(membershipNotice(new Date(now + 7 * 86_400_000).toISOString(), now)?.text ?? "", /7 días/);
  assert.match(membershipNotice(new Date(now + 12 * 3_600_000).toISOString(), now)?.text ?? "", /24 horas/);
  assert.equal(membershipNotice(new Date(now - 1000).toISOString(), now)?.expired, true);
});
