import { AttendanceSource } from '../constants/attendance-enums.js';
import { canOverwrite } from './attendance-source.js';

const { SYSTEM, DEVICE, MANUAL } = AttendanceSource;

describe('canOverwrite', () => {
  describe('when no row exists yet', () => {
    it.each([SYSTEM, DEVICE, MANUAL])('lets %s create the row', (incoming) => {
      expect(canOverwrite(null, incoming)).toBe(true);
    });
  });

  // All nine ordered pairs, spelled out rather than generated from the rank map
  // — a test that derives its expectation from the implementation would pass
  // just as happily with the comparison inverted.
  describe('every ordered pair', () => {
    it.each([
      [SYSTEM, SYSTEM, true],
      [SYSTEM, DEVICE, true],
      [SYSTEM, MANUAL, true],
      [DEVICE, SYSTEM, false],
      [DEVICE, DEVICE, true],
      [DEVICE, MANUAL, true],
      [MANUAL, SYSTEM, false],
      [MANUAL, DEVICE, false],
      [MANUAL, MANUAL, true],
    ] as const)('%s row, %s write -> %s', (existing, incoming, expected) => {
      expect(canOverwrite(existing, incoming)).toBe(expected);
    });
  });

  describe('the cases the module rests on', () => {
    // PRD §4.2: HR marks somebody absent at 11:00, he turns up and punches at
    // 14:00. The punch is stored; the row is not touched.
    it('refuses a device write against a row HR marked by hand', () => {
      expect(canOverwrite(MANUAL, DEVICE)).toBe(false);
    });

    it('lets a device write correct an earlier device write', () => {
      expect(canOverwrite(DEVICE, DEVICE)).toBe(true);
    });

    // The nightly close job writes SYSTEM rows and must never flatten a day a
    // device or a human already decided.
    it('refuses a system write against device and manual rows', () => {
      expect(canOverwrite(DEVICE, SYSTEM)).toBe(false);
      expect(canOverwrite(MANUAL, SYSTEM)).toBe(false);
    });

    it('lets a device write take over a system-generated row', () => {
      expect(canOverwrite(SYSTEM, DEVICE)).toBe(true);
    });

    it('lets a human overrule anything', () => {
      expect(canOverwrite(SYSTEM, MANUAL)).toBe(true);
      expect(canOverwrite(DEVICE, MANUAL)).toBe(true);
      expect(canOverwrite(MANUAL, MANUAL)).toBe(true);
    });
  });

  it('is antisymmetric across different ranks', () => {
    const ordered = [SYSTEM, DEVICE, MANUAL];

    for (const lower of ordered) {
      for (const higher of ordered) {
        if (lower === higher) continue;

        // Exactly one direction is permitted between any two distinct ranks.
        expect(canOverwrite(lower, higher)).not.toBe(
          canOverwrite(higher, lower),
        );
      }
    }
  });
});
