export const isValidIanaTimeZone = (timeZone: string): boolean => {
  // Intl also accepts numeric offsets on newer platforms; these are not IANA zones.
  if (timeZone.startsWith('+') || timeZone.startsWith('-')) {
    return false;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
};

export const getSystemIanaTimeZone = (): string | null => {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone && isValidIanaTimeZone(timeZone) ? timeZone : null;
  } catch {
    return null;
  }
};

export const resolveIanaTimeZone = (
  configuredTimeZone: string | null | undefined,
): string | null => {
  if (configuredTimeZone === null || configuredTimeZone === undefined) {
    return getSystemIanaTimeZone();
  }
  return isValidIanaTimeZone(configuredTimeZone) ? configuredTimeZone : null;
};

/** Wall-clock fields in the requested zone, for small scheduling editors. */
export const zonedDateTimeFields = (
  timestamp: number,
  timeZone: string,
): { date: string; time: string } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  };
};
/** Resolve a wall time; reject DST gaps instead of silently shifting the user's time. */
export const zonedDateTimeToTimestamp = (
  date: string,
  time: string,
  timeZone: string,
): number | null => {
  if (
    !isValidIanaTimeZone(timeZone) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    return null;
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall)) return null;
  let candidate = wall;
  for (let i = 0; i < 4; i++) {
    const fields = zonedDateTimeFields(candidate, timeZone);
    if (fields.date === date && fields.time === time) return candidate;
    candidate += wall - Date.parse(`${fields.date}T${fields.time}:00Z`);
  }
  return null;
};
