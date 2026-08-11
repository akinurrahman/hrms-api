import {
  isNightShift,
  minutesToHHmm,
  netShiftMinutes,
  shiftSpanMinutes,
} from './shift-time.js';

describe('shift-time helpers', () => {
  describe('isNightShift', () => {
    it('is false for a day shift', () => {
      expect(isNightShift({ startMinutes: 540, endMinutes: 1080 })).toBe(false);
    });

    it('is true when the shift ends before it starts', () => {
      expect(isNightShift({ startMinutes: 1320, endMinutes: 360 })).toBe(true);
    });

    it('treats a shift ending at midnight as crossing the day boundary', () => {
      // Midnight is stored as 0, so 14:00 -> 00:00 reads as a night shift.
      // The span arithmetic still lands on the right number.
      expect(isNightShift({ startMinutes: 840, endMinutes: 0 })).toBe(true);
      expect(shiftSpanMinutes({ startMinutes: 840, endMinutes: 0 })).toBe(600);
    });
  });

  describe('shiftSpanMinutes', () => {
    it('measures a day shift directly', () => {
      expect(shiftSpanMinutes({ startMinutes: 540, endMinutes: 1080 })).toBe(
        540,
      );
    });

    it('adds a day when the shift crosses midnight', () => {
      expect(shiftSpanMinutes({ startMinutes: 1320, endMinutes: 360 })).toBe(
        480,
      );
    });
  });

  describe('netShiftMinutes', () => {
    it('subtracts the break from a day shift', () => {
      expect(
        netShiftMinutes({
          startMinutes: 540,
          endMinutes: 1080,
          breakMinutes: 60,
        }),
      ).toBe(480);
    });

    // Phase 1 exit criterion: 22:00-06:00 with a 60-minute break is 420,
    // not a negative number.
    it('stays positive for a night shift', () => {
      expect(
        netShiftMinutes({
          startMinutes: 1320,
          endMinutes: 360,
          breakMinutes: 60,
        }),
      ).toBe(420);
    });

    it('equals the span when there is no break', () => {
      expect(
        netShiftMinutes({
          startMinutes: 1320,
          endMinutes: 360,
          breakMinutes: 0,
        }),
      ).toBe(480);
    });
  });

  describe('minutesToHHmm', () => {
    it('pads both parts', () => {
      expect(minutesToHHmm(545)).toBe('09:05');
      expect(minutesToHHmm(0)).toBe('00:00');
      expect(minutesToHHmm(1439)).toBe('23:59');
    });
  });
});
