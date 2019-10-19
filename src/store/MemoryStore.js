export default class {
  constructor() {
    this.store = {};
  }

  async get(key, optionalDefault = undefined) {
    if (key in this.store) return this.store[key];
    if (typeof optionalDefault === 'undefined') return undefined;
    const value = await (typeof optionalDefault === 'function' ? optionalDefault() : optionalDefault);
    await this.set(key, value);
    return value;
  }

  async set(key, value) {
    this.store[key] = value;
  }
}
