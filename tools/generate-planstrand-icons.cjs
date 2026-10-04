const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
  const calendar = fs
    .readFileSync('src/assets/icons/calendar.svg', 'utf8')
    .replace('fill="currentColor"', 'fill="#ffffff"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="96" y="96" width="832" height="832" rx="180" fill="#325e85"/><svg x="220" y="220" width="584" height="584" viewBox="0 0 24 24">${calendar.match(/<path[^>]+\/>/)[0].replace('<path', '<path fill="#ffffff"')}</svg></svg>`;
  fs.writeFileSync('build/icon-mac.svg', svg + '\n');
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLANSTRAND_ICON_BROWSER || 'msedge',
  });
  const page = await browser.newPage();
  const pngs = new Map();
  for (const size of [
    16, 24, 32, 48, 64, 72, 96, 128, 144, 150, 180, 192, 256, 300, 512, 1024, 1080, 2160,
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
    );
    pngs.set(size, await page.screenshot({ omitBackground: true }));
  }
  const save = (f, size) => fs.writeFileSync(f, pngs.get(size));
  save('build/icon.png', 512);
  for (const f of fs.readdirSync('build/icons')) {
    const m = f.match(/^(?:sq)?(\d+)(?:x\d+)?\.png$/);
    if (m && pngs.has(+m[1])) save('build/icons/' + f, +m[1]);
  }
  for (const f of fs.readdirSync('src/assets/icons')) {
    let size = f.match(/(?:icon|favicon)-(\d+)x\d+\.png$/)?.[1];
    if (f === 'apple-touch-icon.png') size = 180;
    if (f === 'mstile-150x150.png') size = 150;
    if (size && pngs.has(+size)) save('src/assets/icons/' + f, +size);
  }
  save('electron/assets/icons/icon_256x256.png', 256);
  for (const f of ['ico.svg', 'ico-white.svg', 'ico-circled.svg'])
    fs.writeFileSync('electron/assets/icons/' + f, svg + '\n');
  for (const f of ['sp.svg', 'sp-white.svg', 'safari-pinned-tab.svg'])
    fs.writeFileSync('src/assets/icons/' + f, svg + '\n');
  for (const f of ['tray-ico-d.png', 'tray-ico-l.png'])
    save('electron/assets/icons/' + f, 16);
  for (const f of ['tray-ico-d@2x.png', 'tray-ico-l@2x.png'])
    save('electron/assets/icons/' + f, 32);
  // Windows ICO embeds PNG at multiple standard dimensions.
  const sizes = [16, 32, 48, 256];
  let offset = 6 + 16 * sizes.length;
  const header = Buffer.alloc(offset);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  sizes.forEach((size, i) => {
    const o = 6 + 16 * i;
    header[o] = size === 256 ? 0 : size;
    header[o + 1] = header[o];
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(pngs.get(size).length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += pngs.get(size).length;
  });
  fs.writeFileSync(
    'build/icon.ico',
    Buffer.concat([header, ...sizes.map((s) => pngs.get(s))]),
  );
  const entries = [
    ['icon_16x16.png', 16, 'icp4'],
    ['icon_16x16@2x.png', 32, 'ic11'],
    ['icon_32x32.png', 32, 'icp5'],
    ['icon_32x32@2x.png', 64, 'ic12'],
    ['icon_128x128.png', 128, 'ic07'],
    ['icon_128x128@2x.png', 256, 'ic13'],
    ['icon_256x256.png', 256, 'ic08'],
    ['icon_256x256@2x.png', 512, 'ic14'],
    ['icon_512x512.png', 512, 'ic09'],
    ['icon_512x512@2x.png', 1024, 'ic10'],
  ];
  const chunks = entries.map(([f, size, type]) => {
    save('build/icon.iconset/' + f, size);
    const b = Buffer.alloc(8);
    b.write(type);
    b.writeUInt32BE(8 + pngs.get(size).length, 4);
    return Buffer.concat([b, pngs.get(size)]);
  });
  const ih = Buffer.alloc(8);
  ih.write('icns');
  ih.writeUInt32BE(8 + chunks.reduce((n, b) => n + b.length, 0), 4);
  fs.writeFileSync('build/icon.icns', Buffer.concat([ih, ...chunks]));
  await browser.close();
  console.log('Neutral calendar icon assets generated.');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
