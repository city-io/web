import type { Rate } from '$lib/gen/cityio/entity/v1/common_pb';
import type { Duration } from '@bufbuild/protobuf/wkt';

// Canonical period for all displayed rates: every resource flow is shown
// normalized to one hour. The backend ships Rate values as value/scale per
// second (scale is typically 86400), so display is just per-second × 3600.
export const SECONDS_PER_HOUR = 3600;

// ratePerHour converts a Rate (value per `scale` seconds) into a per-hour
// number. Returns 0 when the rate is absent (e.g. owner-only fields hidden
// from non-owners arrive unset).
export const ratePerHour = (r?: Rate): number => (r ? (Number(r.value) / r.scale) * SECONDS_PER_HOUR : 0);

// fmtPerHour formats a signed per-hour flow, e.g. "+12,000", "-48", "0".
export const fmtPerHour = (perHour: number): string => {
  const v = Math.round(perHour);
  if (v === 0) return '0';
  return `${v > 0 ? '+' : ''}${v.toLocaleString()}`;
};

// durationSeconds extracts whole seconds from a protobuf Duration.
export const durationSeconds = (d?: Duration): number => (d ? Number(d.seconds) : 0);
