/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function generate() {
  const directory = path.resolve(__dirname, '../desktop/assets');
  const svg = fs.readFileSync(path.join(directory, 'icon.svg'));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(size => sharp(svg).resize(size, size).ensureAlpha().png().toBuffer()));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); // Windows icon, not a cursor.
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + 16 * index;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  fs.writeFileSync(path.join(directory, 'icon.ico'), Buffer.concat([header, ...images]));
  await sharp(svg).resize(512, 512).ensureAlpha().png().toFile(path.join(directory, 'icon.png'));
  console.log('Generated green shield Windows icons (16–256 px ICO, 512 px PNG).');
}

if (require.main === module) generate().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { generate };
