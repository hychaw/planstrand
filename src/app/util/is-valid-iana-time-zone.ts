/** Pure validation shared by scheduling and headless operator recovery. */
export const isValidIanaTimeZone = (timeZone: string): boolean => {
  // Intl also accepts numeric offsets on newer platforms; these are not IANA zones.
  if (timeZone.startsWith('+') || timeZone.startsWith('-')) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
};
