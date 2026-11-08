import { writeFile } from 'node:fs/promises';

// Original procedural tile emblem; no remote or third-party art is included.
export async function createIcon(output) {
  const size = 256, pixels = Buffer.alloc(size * size * 4);
  const rounded = (x, y, left, top, width, height, radius) => {
    const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
    const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
    return x >= left && x <= left + width && y >= top && y <= top + height && dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let color = [0, 0, 0, 0];
    if (rounded(x, y, 12, 12, 232, 232, 48)) color = [17, 49, 39, 255];
    if (rounded(x, y, 39, 27, 178, 202, 20)) color = [194, 167, 103, 255];
    if (rounded(x, y, 44, 32, 168, 192, 17)) color = [38, 87, 68, 255];
    if (rounded(x, y, 44, 32, 168, 177, 17)) color = [247, 239, 214, 255];
    for (const stickX of [80, 121, 162]) {
      if (rounded(x, y, stickX, 69, 15, 101, 7)) color = [26, 91, 62, 255];
      if (x >= stickX - 4 && x <= stickX + 19 && ((y >= 93 && y <= 99) || (y >= 138 && y <= 144))) color = [26, 91, 62, 255];
    }
    const i = ((size - 1 - y) * size + x) * 4;
    pixels[i] = color[2]; pixels[i + 1] = color[1]; pixels[i + 2] = color[0]; pixels[i + 3] = color[3];
  }
  const mask = Buffer.alloc(size * size / 8), dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(pixels.length + mask.length, 20);
  const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(dib.length + pixels.length + mask.length, 14); header.writeUInt32LE(22, 18);
  await writeFile(output, Buffer.concat([header, dib, pixels, mask]));
}
