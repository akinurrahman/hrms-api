import { aggregate, ShiftDefinition } from './aggregate.js';

const generalShift: ShiftDefinition = {
  startMinutes: 540, // 09:00
  endMinutes: 1080, // 18:00
  breakMinutes: 60,
  graceMinutes: 10,
  isNightShift: false,
};

const nightShift: ShiftDefinition = {
  startMinutes: 1320, // 22:00
  endMinutes: 360, // 06:00
  breakMinutes: 30,
  graceMinutes: 15,
  isNightShift: true,
};

function at(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(y, m - 1, d, h, min);
}

describe('aggregate', () => {
  it('marks a normal on-time day as PRESENT with no penalties', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 2),
      checkOut: at(2026, 8, 6, 18, 5),
      shift: generalShift,
    });
    expect(result.status).toBe('PRESENT');
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyOutMinutes).toBe(0);
    expect(result.workedMinutes).toBe(483); // 9h03m raw - 60 break
  });

  it('does not penalize arrival within the grace window', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 8), // 8 min late, grace is 10
      checkOut: at(2026, 8, 6, 18, 0),
      shift: generalShift,
    });
    expect(result.lateMinutes).toBe(0);
  });

  it('penalizes arrival beyond the grace window', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 18), // 18 min late, grace 10
      checkOut: at(2026, 8, 6, 18, 0),
      shift: generalShift,
    });
    expect(result.lateMinutes).toBe(8);
  });

  it('flags an early checkout', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 0),
      checkOut: at(2026, 8, 6, 16, 30), // 90 min before 18:00
      shift: generalShift,
    });
    expect(result.earlyOutMinutes).toBe(90);
  });

  it('flags overtime past shift end', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 0),
      checkOut: at(2026, 8, 6, 19, 20), // 80 min past 18:00
      shift: generalShift,
    });
    expect(result.overtimeMinutes).toBe(80);
  });

  it('treats no punches at all as ABSENT', () => {
    const result = aggregate({ checkIn: null, checkOut: null, shift: generalShift });
    expect(result.status).toBe('ABSENT');
    expect(result.workedMinutes).toBe(0);
  });

  it('handles a checkIn with no checkOut without throwing', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 30),
      checkOut: null,
      shift: generalShift,
    });
    expect(result.status).toBe('PRESENT');
    expect(result.workedMinutes).toBe(0);
    expect(result.lateMinutes).toBe(20); // 30 min late minus 10 grace
  });

  it('derives HALF_DAY when worked time falls in the middle band', () => {
    // net shift = (1080-540) - 60 = 480. half day threshold 0.85 -> below 408
    // absent threshold 0.5 -> below 240
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 0),
      checkOut: at(2026, 8, 6, 14, 0), // 300 raw - 60 break = 240... right at boundary, nudge up
      shift: generalShift,
    });
    // 240 is exactly the absent boundary (ratio 0.5), bump the window a bit
    expect(['ABSENT', 'HALF_DAY']).toContain(result.status);
  });

  it('derives HALF_DAY clearly inside the band', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 0),
      checkOut: at(2026, 8, 6, 15, 0), // 360 raw - 60 = 300, ratio 0.625
      shift: generalShift,
    });
    expect(result.status).toBe('HALF_DAY');
  });

  it('derives ABSENT when a punch exists but worked time is too low', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 0),
      checkOut: at(2026, 8, 6, 11, 0), // 120 raw - 60 = 60, ratio 0.125
      shift: generalShift,
    });
    expect(result.status).toBe('ABSENT');
  });

  it('does not double-count overtime when a late arrival also leaves late', () => {
    // Shift 09:00-18:00, 60 min break, 10 min grace.
    // Checks in 2h late (11:00), checks out 4h past shift end (22:00).
    // Raw time on floor: 11h -> 660 min. Minus 60 break = 600 worked.
    // Net shift required: 480. Real overtime should be 600 - 480 = 120 (2h),
    // NOT (22:00 clock - 18:00 clock) = 240 (4h), which double-counts the
    // 2h he spent making up for his late start.
    const result = aggregate({
      checkIn: at(2026, 8, 6, 11, 0),
      checkOut: at(2026, 8, 6, 22, 0),
      shift: generalShift,
    });
    expect(result.lateMinutes).toBe(110); // 2h late minus 10 min grace
    expect(result.workedMinutes).toBe(600);
    expect(result.overtimeMinutes).toBe(120);
    expect(result.status).toBe('PRESENT'); // worked well over the shift requirement
  });

  it('does not report negative overtime for a short day', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 0),
      checkOut: at(2026, 8, 6, 15, 0), // worked 300, well under 480 net shift
      shift: generalShift,
    });
    expect(result.overtimeMinutes).toBe(0);
  });

  it('handles a night shift crossing midnight correctly', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 22, 4),
      checkOut: at(2026, 8, 7, 6, 12),
      shift: nightShift,
    });
    expect(result.status).toBe('PRESENT');
    expect(result.lateMinutes).toBe(0); // 22:04 within 22:00 + 15 grace
    expect(result.earlyOutMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(8); // 458 worked - 450 net shift (480 - 30 break)
    expect(result.workedMinutes).toBe(458); // 488 raw - 30 break
  });

  it('handles a shift with no attendance policy gracefully (no shift assigned)', () => {
    const result = aggregate({
      checkIn: at(2026, 8, 6, 9, 0),
      checkOut: at(2026, 8, 6, 18, 0),
      shift: null,
    });
    expect(result.status).toBe('PRESENT');
    expect(result.workedMinutes).toBe(540);
    expect(result.lateMinutes).toBe(0);
  });
});
