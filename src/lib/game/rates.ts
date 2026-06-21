import type { Rate } from '$lib/gen/cityio/entity/v1/common_pb';
import type { Duration } from '@bufbuild/protobuf/wkt';

// Canonical period for all displayed rates: every resource flow is shown
// normalized to one day. The backend ships Rate values with scale = 86400.
export const SECONDS_PER_DAY = 86400;

// ratePerDay converts a Rate (value per `scale` seconds) into a per-day number.
// Returns 0 when the rate is absent (e.g. owner-only fields hidden from
// non-owners arrive unset).
export const ratePerDay = (r?: Rate): number => (r ? (Number(r.value) / r.scale) * SECONDS_PER_DAY : 0);

// fmtPerDay formats a signed per-day flow, e.g. "+288,000", "-1,152", "0".
export const fmtPerDay = (perDay: number): string => {
  const v = Math.round(perDay);
  if (v === 0) return '0';
  return `${v > 0 ? '+' : ''}${v.toLocaleString()}`;
};

// durationSeconds extracts whole seconds from a protobuf Duration.
export const durationSeconds = (d?: Duration): number => (d ? Number(d.seconds) : 0);
