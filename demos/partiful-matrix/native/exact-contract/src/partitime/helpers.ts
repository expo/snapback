declare const __PARTITIME_BACKEND__: string;

export function backendName(): string {
  return __PARTITIME_BACKEND__;
}

export function formatWhen(milliseconds: number): string {
  // Contract treats Date formatting as an ambient host read. Convert Unix time
  // with integer arithmetic so macOS and iOS render the same deterministic text.
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const minuteOfDay = totalMinutes - days * 24 * 60;
  const hour24 = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  // Howard Hinnant's civil-from-days conversion, shifted from Unix epoch days.
  const z = days + 719_468;
  const era = Math.floor((z >= 0 ? z : z - 146_096) / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1_460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekday = weekdays[((days + 4) % 7 + 7) % 7];
  const hour = hour24 % 12 || 12;
  const period = hour24 < 12 ? 'AM' : 'PM';
  const paddedMinute = minute.toString().padStart(2, '0');

  return `${weekday}, ${months[month - 1]} ${day}, ${year} · ${hour}:${paddedMinute} ${period} UTC`;
}

export function statusLabel(status: string): string {
  if (status === 'host') return 'Hosting';
  if (status === 'going') return 'Going';
  if (status === 'maybe') return 'Maybe';
  if (status === 'cant') return "Can't go";
  return status;
}

export function goingCount(rows: Array<{ status: string }>): number {
  return rows.filter((row) => row.status === 'host' || row.status === 'going').length;
}

export function myStatus(
  rows: Array<{ userId: string; status: string }>,
  userId: string,
): string {
  return rows.find((row) => row.userId === userId)?.status ?? 'none';
}
