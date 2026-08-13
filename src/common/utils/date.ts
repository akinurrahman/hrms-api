import { format } from 'date-fns';

export function toUtcDateOnly(date: string | Date): Date {
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);

    if (match) {
      const [, year, month, day] = match;
      const utc = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day)),
      );

      if (
        utc.getUTCFullYear() !== Number(year) ||
        utc.getUTCMonth() !== Number(month) - 1 ||
        utc.getUTCDate() !== Number(day)
      ) {
        throw new RangeError(`Invalid calendar date: ${date}`);
      }

      return utc;
    }
  }

  const parsed = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid date: ${String(date)}`);
  }

  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

export function toDateKey(date: Date | string): string {
  return format(toUtcDateOnly(date), 'yyyy-MM-dd');
}
