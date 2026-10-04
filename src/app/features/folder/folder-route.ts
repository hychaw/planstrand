import { INBOX_FOLDER_ID } from './folder.const';

/** Primary capture defaults; undefined preserves the upstream Project/Tag workflow. */
export const folderForPlanstrandRoute = (url: string): string | undefined => {
  const path = url.split(/[?#]/)[0];
  if (['/inbox', '/master-tasks', '/today', '/this-week'].includes(path))
    return INBOX_FOLDER_ID;
  const match = /^\/folder\/([^/]+)$/.exec(path);
  return match ? decodeURIComponent(match[1]) : undefined;
};
