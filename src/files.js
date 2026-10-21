'use strict';
const { TextDecoder } = require('node:util');
function textContent(bytes) {
  let encoding = 'utf-8', data = bytes;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; data = bytes.subarray(2); }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; data = bytes.subarray(2); }
  else if (bytes.length >= 8 && bytes.length % 2 === 0) {
    const pairs = Math.min(bytes.length / 2, 1024); let odd = 0, even = 0;
    for (let i = 0; i < pairs; i++) { if (!bytes[2 * i]) even++; if (!bytes[2 * i + 1]) odd++; }
    if (odd / pairs > .35 && even / pairs < .05) encoding = 'utf-16le';
    else if (even / pairs > .35 && odd / pairs < .05) encoding = 'utf-16be';
  }
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(data);
    if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) return null;
    return { text, encoding };
  } catch { return null; }
}
function classifyFile(bytes, path = '') {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-' || /\.pdf$/i.test(path)) return { kind: 'binary' };
  let mime;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = 'image/jpeg';
  else if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'))) mime = 'image/gif';
  else if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') mime = 'image/webp';
  if (mime) return { kind: 'binary' };
  const text = textContent(bytes);
  return text ? { kind: 'text', ...text } : { kind: 'binary' };
}
module.exports = { textContent, classifyFile };
