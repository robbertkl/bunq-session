import { readFile, writeFile } from 'fs';
import { promisify } from 'util';
import { Mutex } from 'async-mutex';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

export default class {
  constructor(file) {
    this.file = file;
    this.mutex = new Mutex();
    this.cache = null;
  }

  async read() {
    const release = await this.mutex.acquire();
    try {
      return JSON.parse(await readFileAsync(this.file));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    } finally {
      release();
    }
  }

  async write(object) {
    const release = await this.mutex.acquire();
    try {
      await writeFileAsync(this.file, JSON.stringify(object));
    } finally {
      release();
    }
  }

  async get(key, optionalDefault = undefined) {
    if (this.cache === null) this.cache = await this.read();
    if (key in this.cache) return this.cache[key];
    if (typeof optionalDefault === 'undefined') return undefined;
    const value = await (typeof optionalDefault === 'function' ? optionalDefault() : optionalDefault);
    await this.set(key, value);
    return value;
  }

  async set(key, value) {
    if (this.cache === null) this.cache = await this.read();
    const cache = { ...this.cache };
    cache[key] = value;
    await this.write(cache);
    this.cache = cache;
  }

  async delete(key) {
    if (this.cache === null) this.cache = await this.read();
    const cache = { ...this.cache };
    delete cache[key];
    await this.write(cache);
    this.cache = cache;
  }
}
