import { app } from 'electron';
import { join } from 'path';

// Loaded first by main.ts, before modules resolve backup/settings paths or the
// single-instance lock. Explicit test/custom profiles never touch a live profile.
app.setName('Planstrand');
const customProfile = process.argv.find((arg) => arg.startsWith('--user-data-dir='));
app.setPath(
  'userData',
  customProfile
    ? customProfile
        .slice('--user-data-dir='.length)
        .trim()
        .replace(/[\/\\]+$/, '')
    : join(app.getPath('appData'), 'Planstrand'),
);
