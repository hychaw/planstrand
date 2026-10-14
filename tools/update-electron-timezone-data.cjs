// ICU's documented .dat resource replacement, without a native icupkg dependency.
// Chromium's sandbox cannot read ICU_TIMEZONE_FILES_DIR. Update the shared package
// before launch so main, renderer, preload and workers all load the same rules.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const manifest = require('./icu-timezone-data/manifest.json');

const assert = (condition, message) => {
  if (!condition) throw new Error(`ICU timezone update: ${message}`);
};

const validateHeader = (data, format) => {
  assert(data.length >= 32, 'truncated data header');
  assert(data[2] === 0xda && data[3] === 0x27, 'invalid ICU magic');
  assert(
    data[8] === 0 && data[9] === 0 && data[10] === 2,
    'requires little-endian ASCII ICU data',
  );
  assert(data.toString('ascii', 12, 16) === format, `expected ${format} format`);
  const size = data.readUInt16LE(0);
  assert(size >= 24 && size < data.length, 'invalid header size');
  return size;
};

const readPackage = (data) => {
  const header = validateHeader(data, 'CmnD');
  assert(data[16] === 1, 'unsupported package format version');
  const count = data.readUInt32LE(header);
  const tableEnd = header + 4 + count * 8;
  assert(count > 0 && tableEnd < data.length, 'invalid resource table');
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameAt = header + data.readUInt32LE(header + 4 + i * 8);
    const start = header + data.readUInt32LE(header + 8 + i * 8);
    const nameEnd = data.indexOf(0, nameAt);
    assert(
      nameAt >= tableEnd && nameEnd >= nameAt && nameEnd < start,
      'invalid resource name',
    );
    assert(start % 16 === 0 && start < data.length, 'invalid resource offset');
    assert(i === 0 || start > entries[i - 1].start, 'unordered resource offsets');
    entries.push({ name: data.toString('ascii', nameAt, nameEnd), start });
  }
  assert(
    entries.every((entry) => entry.name.startsWith('icudt') && entry.name.includes('l/')),
    'unexpected package names',
  );
  return { header, entries };
};

const timeZoneVersion = (resource) => {
  validateHeader(resource, 'ResB');
  const versions = [
    ...resource.toString('utf16le').matchAll(/\u0000(20\d{2}[a-z]+)\u0000/g),
  ];
  assert(versions.length === 1, 'cannot identify timezone resource version');
  return versions[0][1];
};

const isAtLeast = (version, minimum) => {
  const year = Number(version.slice(0, 4)) - Number(minimum.slice(0, 4));
  if (year !== 0) return year > 0;
  const a = version.slice(4),
    b = minimum.slice(4);
  return a.length === b.length ? a >= b : a.length > b.length;
};

const updateTimeZoneData = (data) => {
  const { header, entries } = readPackage(data);
  const resources = new Map();
  for (const [index, entry] of entries.entries()) {
    const end = entries[index + 1]?.start ?? data.length;
    const name = entry.name.slice(entry.name.indexOf('/') + 1);
    if (Object.hasOwn(manifest.sha256, name)) {
      assert(!resources.has(name), `duplicate resource ${name}`);
      resources.set(name, data.subarray(entry.start, end));
    }
  }
  assert(resources.size === 4, 'expected all four timezone resources');
  const version = timeZoneVersion(resources.get('zoneinfo64.res'));
  // Never downgrade newer Electron timezone data, or rewrite an up-to-date file.
  if (isAtLeast(version, manifest.version)) return data;
  const replacements = new Map();
  for (const [name, hash] of Object.entries(manifest.sha256)) {
    const replacement = fs.readFileSync(
      path.join(__dirname, 'icu-timezone-data', manifest.version, name),
    );
    assert(
      createHash('sha256').update(replacement).digest('hex') === hash,
      `checksum mismatch: ${name}`,
    );
    validateHeader(replacement, 'ResB');
    replacements.set(name, replacement);
  }
  assert(
    timeZoneVersion(replacements.get('zoneinfo64.res')) === manifest.version,
    'replacement version mismatch',
  );
  const prefix = Buffer.from(data.subarray(0, entries[0].start));
  const chunks = [prefix];
  let offset = prefix.length;
  for (const [index, entry] of entries.entries()) {
    const name = entry.name.slice(entry.name.indexOf('/') + 1);
    const resource =
      replacements.get(name) ??
      data.subarray(entry.start, entries[index + 1]?.start ?? data.length);
    prefix.writeUInt32LE(offset - header, header + 8 + index * 8);
    chunks.push(resource);
    offset += resource.length;
    const padding = (16 - (offset % 16)) % 16;
    if (padding) chunks.push(Buffer.alloc(padding));
    offset += padding;
  }
  const result = Buffer.concat(chunks);
  readPackage(result);
  return result;
};

const updateTimeZoneFile = (filename) => {
  const original = fs.readFileSync(filename);
  const updated = updateTimeZoneData(original);
  if (updated === original) return false;
  const temporary = `${filename}.${process.pid}.tmp`;
  let created = false;
  try {
    fs.writeFileSync(temporary, updated, { flag: 'wx' });
    created = true;
    fs.renameSync(temporary, filename);
  } finally {
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  console.log(`Updated ${filename} timezone resources to ${manifest.version}`);
  return true;
};

module.exports = { updateTimeZoneData, updateTimeZoneFile, readPackage, timeZoneVersion };

if (require.main === module && process.platform === 'win32') {
  updateTimeZoneFile(path.join(path.dirname(require('electron')), 'icudtl.dat'));
}
