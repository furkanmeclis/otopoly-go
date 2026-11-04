const mem = new Map();
const asyncStorage = { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => void mem.set(k, v), removeItem: async (k) => void mem.delete(k) };
module.exports = {
  // esbuild's CJS interop hands `import AsyncStorage from` the whole module, so expose the methods at the top level too.
  ...asyncStorage,
  default: asyncStorage,
  getItemAsync: async (k) => mem.get(k) ?? null, setItemAsync: async (k, v) => void mem.set(k, v), deleteItemAsync: async (k) => void mem.delete(k),
  getLocales: () => [{ languageCode: 'tr' }],
};
