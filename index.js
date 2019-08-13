const esm = require('esm');
const pkg = require('./package.json');

// eslint-disable-next-line no-global-assign
require = esm(module);

// eslint-disable-next-line import/no-dynamic-require
module.exports = require(pkg.module);
