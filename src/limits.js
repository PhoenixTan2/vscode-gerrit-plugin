'use strict';
const {tr} = require('./i18n');
const RESPONSE_LIMIT = 32 * 1024 * 1024;
// Gerrit content responses contain Base64, which expands bytes by 4/3.
function fileLimitReason(file = {}, bothSides = true) {
  const sizes = [file.size];
  if (bothSides && Number.isFinite(file.size) && Number.isFinite(file.size_delta)) sizes.push(file.size - file.size_delta);
  return sizes.some(size => Number.isFinite(size) && size >= 0 && 4 * Math.ceil(size / 3) > RESPONSE_LIMIT)
    ? tr('文件内容编码后的响应超过 32MB 限制，无法在插件中打开') : '';
}
module.exports = { RESPONSE_LIMIT, fileLimitReason };
