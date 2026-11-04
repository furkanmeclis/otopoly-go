// expo-file-system / expo-sharing stand-ins for the node contract bundle (downloads are not part of the JSON contract).
class File {
  constructor(...parts) {
    this.uri = parts.map((p) => (typeof p === 'string' ? p : (p?.uri ?? ''))).join('/');
  }
  write() {}
  text() {
    return '';
  }
  get exists() {
    return false;
  }
}
module.exports = {
  File,
  Paths: { cache: { uri: 'file:///cache' }, document: { uri: 'file:///doc' } },
  shareAsync: async () => {},
  isAvailableAsync: async () => false,
};
