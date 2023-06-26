import pJSON from '../package.json';
export const version = pJSON.version;
export const getVersion = () => {
  return pJSON.version || '0';
};
export * from "./libcip54"
