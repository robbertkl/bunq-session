import { readFile, writeFile } from 'fs';
import { promisify } from 'util';
import { Mutex } from 'async-mutex';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

export default class {
  constructor(file, { pretty = true } = {}) {
    this.file = file;
    this.pretty = pretty;
    this.mutex = new Mutex();
    this.store = null;
  }

  async get(key, optionalDefault = undefined) {
    if (!this.store) {
      const release = await this.mutex.acquire();
      try {
        if (!this.store) {
          this.store = JSON.parse(await readFileAsync(this.file));
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          this.store = {};
        } else {
          throw error;
        }
      } finally {
        release();
      }
    }

    if (key in this.store) return this.store[key];
    if (typeof optionalDefault === 'undefined') return undefined;
    const value = await (typeof optionalDefault === 'function' ? optionalDefault() : optionalDefault);
    await this.set(key, value);
    return value;
  }

  async set(key, value) {
    const release = await this.mutex.acquire();
    try {
      const store = { ...this.store, [key]: value };
      const json = this.pretty ? JSON.stringify(store, null, 2) : JSON.stringify(store);
      await writeFileAsync(this.file, json);
      this.store = store;
    } finally {
      release();
    }
  }
}
