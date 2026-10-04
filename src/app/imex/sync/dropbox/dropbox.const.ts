import { getEnvOptional } from '../../../util/env';
import { environment } from '../../../../environments/environment';

// No upstream OAuth identity: only a deliberately configured Planstrand-owned key.
export const DROPBOX_APP_KEY = getEnvOptional('DROPBOX_API_KEY') || '';

export const DROPBOX_APP_FOLDER = 'super_productivity';
const prefix = environment.production ? '' : 'dev_';
export const DROPBOX_SYNC_MAIN_FILE_PATH = `/${DROPBOX_APP_FOLDER}/${prefix}sp-main.json`;
export const DROPBOX_SYNC_ARCHIVE_FILE_PATH = `/${DROPBOX_APP_FOLDER}/${prefix}sp-archive.json`;
