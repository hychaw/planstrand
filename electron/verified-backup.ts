import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getBackupTimestamp } from './shared-with-frontend/get-backup-timestamp';

/** Publish only complete, readable JSON. Never reuse a previous backup's name. */
export const writeVerifiedBackup = (directory: string, data: unknown): string => {
  let temporaryPath: string | undefined;
  let unverifiedPublishedPath: string | undefined;
  let fd: number | undefined;
  let stage = 'serialization';
  try {
    const serialized = JSON.stringify(data);
    if (serialized === undefined) throw new Error('No JSON data');
    JSON.parse(serialized);
    stage = 'directory creation';
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, `${getBackupTimestamp()}-${randomUUID()}.json`);
    if (existsSync(filePath)) throw new Error('Backup name collision');
    const candidateTemporaryPath = `${filePath}.tmp`;
    stage = 'temporary file creation';
    fd = openSync(candidateTemporaryPath, 'wx', 0o600);
    temporaryPath = candidateTemporaryPath;
    stage = 'write';
    writeFileSync(fd, serialized, 'utf8');
    stage = 'flush';
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    stage = 'verification';
    if (readFileSync(temporaryPath, 'utf8') !== serialized) {
      throw new Error('Backup verification failed');
    }
    stage = 'publication';
    renameSync(temporaryPath, filePath);
    temporaryPath = undefined;
    unverifiedPublishedPath = filePath;
    // Verify the published file too; an acknowledgement means it can be read.
    stage = 'published verification';
    if (readFileSync(filePath, 'utf8') !== serialized) {
      throw new Error('Backup verification failed');
    }
    unverifiedPublishedPath = undefined;
    return filePath;
  } catch (e) {
    // Serialization and filesystem errors may contain user content/paths.
    // Do not pass their messages or causes to IPC or diagnostic logs.
    const code = (e as NodeJS.ErrnoException)?.code;
    const safeCode =
      typeof code === 'string' && /^E[A-Z0-9_]+$/.test(code) ? ` (${code})` : '';
    throw new Error(`Backup ${stage} failed${safeCode}`);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The operation has already failed; keep the original safe error.
      }
    }
    const failedPath = temporaryPath ?? unverifiedPublishedPath;
    if (failedPath) {
      try {
        unlinkSync(failedPath);
      } catch {
        // Best-effort removal of this attempt only; older backups are untouched.
      }
    }
  }
};
