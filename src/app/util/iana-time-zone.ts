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
