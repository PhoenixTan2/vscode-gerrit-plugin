'use strict';
let language = 'zh-CN';
const {create} = require('../media/i18n');
const tr = create(() => language);
module.exports = {tr, setLanguage(value) { language = value === 'en' ? 'en' : 'zh-CN'; }};
