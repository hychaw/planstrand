/** Reader requirements are entity capabilities, independent of the persisted schema. */
export const hasMeaningfulFolderState = (state: unknown): boolean => {
  if (!state || typeof state !== 'object' || !Object.hasOwn(state, 'folder'))
    return false;
  const folder = (state as { folder?: unknown }).folder;
  if (!folder || typeof folder !== 'object') return true;
  const { ids, entities, legacyProjectMigrationComplete, ...rest } = folder as {
    ids?: unknown;
    entities?: unknown;
    legacyProjectMigrationComplete?: unknown;
  };
  if (legacyProjectMigrationComplete !== undefined || Object.keys(rest).length)
    return true;
  if (
    !Array.isArray(ids) ||
    ids.length !== 1 ||
    ids[0] !== 'INBOX_FOLDER' ||
    !entities ||
    typeof entities !== 'object' ||
    Object.keys(entities).length !== 1
  )
    return true;
  const inbox = (entities as Record<string, unknown>)['INBOX_FOLDER'];
  if (!inbox || typeof inbox !== 'object') return true;
  const f = inbox as Record<string, unknown>;
  return (
    f['id'] !== 'INBOX_FOLDER' ||
    f['title'] !== 'Inbox' ||
    (f['parentId'] ?? null) !== null ||
    (f['orderKey'] ?? 'V') !== 'V' ||
    Object.keys(f).some((k) => !['id', 'title', 'parentId', 'orderKey'].includes(k))
  );
};
/** Absent or exact empty additive slices need no new reader capability. Malformed
 * present slices are fenced too; they must never be silently discarded by readers.
 */
export const hasEventSeriesState = (state: unknown): boolean => {
  if (!state || typeof state !== 'object' || !Object.hasOwn(state, 'eventSeries'))
    return false;
  const slice = (state as { eventSeries?: unknown }).eventSeries;
  if (!slice || typeof slice !== 'object' || Array.isArray(slice)) return true;
  const v = slice as { ids?: unknown; entities?: unknown };
  return (
    !Array.isArray(v.ids) ||
    v.ids.length > 0 ||
    !v.entities ||
    typeof v.entities !== 'object' ||
    Array.isArray(v.entities) ||
    Object.keys(v.entities).length > 0 ||
    Object.keys(v).some((key) => !['ids', 'entities'].includes(key))
  );
};
export const hasWeeklyTemplateState = (state: unknown): boolean => {
  if (!state || typeof state !== 'object' || !Object.hasOwn(state, 'weeklyTemplate'))
    return false;
  const slice = (state as { weeklyTemplate?: unknown }).weeklyTemplate;
  if (!slice || typeof slice !== 'object' || Array.isArray(slice)) return true;
  const v = slice as { ids?: unknown; entities?: unknown };
  return (
    !Array.isArray(v.ids) ||
    v.ids.length > 0 ||
    !v.entities ||
    typeof v.entities !== 'object' ||
    Array.isArray(v.entities) ||
    Object.keys(v.entities).length > 0 ||
    Object.keys(v).some((key) => !['ids', 'entities'].includes(key))
  );
};
export const hasOccurrenceExceptionState = (state: unknown): boolean => {
  if (!state || typeof state !== 'object' || !Object.hasOwn(state, 'occurrenceException'))
    return false;
  const slice = (state as { occurrenceException?: unknown }).occurrenceException;
  if (!slice || typeof slice !== 'object' || Array.isArray(slice)) return true;
  const v = slice as { ids?: unknown; entities?: unknown };
  return (
    !Array.isArray(v.ids) ||
    v.ids.length > 0 ||
    !v.entities ||
    typeof v.entities !== 'object' ||
    Array.isArray(v.entities) ||
    Object.keys(v.entities).length > 0 ||
    Object.keys(v).some((key) => !['ids', 'entities'].includes(key))
  );
};

export const getFullStateRequiredEntityTypes = (state: unknown): string[] => {
  const required = hasMeaningfulFolderState(state) ? ['FOLDER'] : [];
  if (hasOccurrenceExceptionState(state)) required.push('OCCURRENCE_EXCEPTION');
  if (hasEventSeriesState(state)) required.push('EVENT_SERIES');
  if (hasWeeklyTemplateState(state)) required.push('WEEKLY_TEMPLATE');
  if (state && typeof state === 'object' && Object.hasOwn(state, 'event')) {
    const event = (state as { event?: unknown }).event;
    // Only the exact optional empty slice is safe for an unaware reader.
    if (!event || typeof event !== 'object' || Array.isArray(event))
      required.push('EVENT');
    else {
      const v = event as { ids?: unknown; entities?: unknown };
      if (
        !Array.isArray(v.ids) ||
        v.ids.length ||
        !v.entities ||
        typeof v.entities !== 'object' ||
        Array.isArray(v.entities) ||
        Object.keys(v.entities).length ||
        Object.keys(v).some((k) => !['ids', 'entities'].includes(k))
      )
        required.push('EVENT');
    }
  }
  return required;
};
export const supportsRequiredEntityTypes = (
  required: unknown,
  supported: readonly string[],
): boolean =>
  required === undefined ||
  (Array.isArray(required) &&
    required.every((type) => typeof type === 'string' && supported.includes(type)));
