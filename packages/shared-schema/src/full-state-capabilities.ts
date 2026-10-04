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
export const getFullStateRequiredEntityTypes = (state: unknown): string[] => {
  const required = hasMeaningfulFolderState(state) ? ['FOLDER'] : [];
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
