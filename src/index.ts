import pJSON from '../package.json';
import * as Libcip54 from './libcip54.js';
const version = pJSON.version;
const getVersion = () => {
  return pJSON.version || '0';
};
module.exports = { ...Libcip54, version, getVersion };
