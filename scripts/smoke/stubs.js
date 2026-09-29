const mem = new Map();
module.exports = {
  default: { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => void mem.set(k, v), removeItem: async (k) => void mem.delete(k) },
  getItemAsync: async (k) => mem.get(k) ?? null, setItemAsync: async (k, v) => void mem.set(k, v), deleteItemAsync: async (k) => void mem.delete(k),
  getLocales: () => [{ languageCode: 'tr' }],
};
