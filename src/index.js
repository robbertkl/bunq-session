import bunqHttp from 'bunq-http';
import { rsa, pki } from 'node-forge';
import { Mutex } from 'async-mutex';
import { promisify } from 'util';
import { name as packageName, version as packageVersion } from '../package.json';
import MemoryStore from './store/MemoryStore.js';
import throttle from './throttle.js';

const generateKeyPair = promisify(rsa.generateKeyPair);

const productionHost = 'api.bunq.com';
const sandboxHost = 'public-api.sandbox.bunq.com';

export { default as FileStore } from './store/FileStore.js';
export { default as MemoryStore } from './store/MemoryStore.js';

export class BunqSession {
  constructor(
    apiKey,
    {
      deviceDescription = packageName,
      persistSession = true,
      sandbox = false,
      store = new MemoryStore(),
      version = 'v1',
    } = {}
  ) {
    Object.assign(this, {
      apiKey,
      deviceDescription,
      persistSession,
      store,
    });

    this.http = bunqHttp({
      baseURL: `https://${sandbox ? sandboxHost : productionHost}/${version}`,
      headers: {
        common: {
          'User-Agent': `${packageName}/${packageVersion}`,
        },
      },
      rateLimit: {
        get: throttle(3, 3000),
        post: throttle(5, 3000),
        put: throttle(2, 3000),
      },
    });

    this.mutex = new Mutex();
    this.session = undefined;
  }

  async login() {
    let release;
    try {
      if (!this.http.defaults.bunq.clientPrivateKey) {
        if (!release) release = await this.mutex.acquire();
        if (!this.http.defaults.bunq.clientPrivateKey) {
          const clientPrivateKeyPem = await this.store.get('clientPrivateKey', async () => {
            const keyPair = await generateKeyPair({ bits: 2048 });
            return pki.privateKeyToPem(keyPair.privateKey);
          });
          this.http.defaults.bunq.clientPrivateKey = pki.privateKeyFromPem(clientPrivateKeyPem);
        }
      }

      if (!this.http.defaults.bunq.serverPublicKey || !this.installationToken) {
        if (!release) release = await this.mutex.acquire();
        if (!this.http.defaults.bunq.serverPublicKey || !this.installationToken) {
          const installation = await this.store.get('installation', async () => {
            const response = await this.http.post(
              'installation',
              { client_public_key: pki.publicKeyToPem(this.http.defaults.bunq.clientPrivateKey) },
              { bunq: { shouldSignRequest: false, shouldVerifyResponseSignature: false } }
            );
            return {
              token: response.bunq.objectsByType.Token[0].token,
              serverPublicKey: response.bunq.objectsByType.ServerPublicKey[0].server_public_key,
            };
          });
          this.http.defaults.bunq.serverPublicKey = pki.publicKeyFromPem(installation.serverPublicKey);
          this.installationToken = installation.token;
        }
      }

      if (!this.deviceId) {
        if (!release) release = await this.mutex.acquire();
        if (!this.deviceId) {
          this.deviceId = await this.store.get('deviceId', async () => {
            const response = await this.http.post(
              'device-server',
              { secret: this.apiKey, description: this.deviceDescription },
              { bunq: { token: this.installationToken } }
            );
            return response.bunq.objectsByType.Id[0].id;
          });
        }
      }

      if (!this.session) {
        if (!release) release = await this.mutex.acquire();
        if (this.session === undefined && this.persistSession) {
          this.session = await this.store.get('session');
        }
        if (!this.session) {
          const response = await this.http.post(
            'session-server',
            { secret: this.apiKey },
            { bunq: { token: this.installationToken } }
          );
          const userObject =
            'UserPerson' in response.bunq.objectsByType
              ? response.bunq.objectsByType.UserPerson[0]
              : response.bunq.objectsByType.UserCompany[0];
          this.session = {
            token: response.bunq.objectsByType.Token[0].token,
            userId: userObject.id,
            userType: userObject.__type, // eslint-disable-line no-underscore-dangle
          };
          if (this.persistSession) {
            await this.store.set('session', this.session);
          }
        }

        this.http.defaults.bunq.token = this.session.token;
      }
    } finally {
      if (release) release();
    }
  }

  async getUserId() {
    await this.login();
    return this.session.userId;
  }

  async getUserType() {
    await this.login();
    return this.session.userType;
  }

  async request(method, resource, options = {}, data = null) {
    await this.login();

    options.method = method;
    options.url = resource;
    if (data) options.data = data;

    try {
      return await this.http.request(options);
    } catch (error) {
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        // Possibly expired session, retry with fresh one
        this.session = null;
        await this.login();
        return this.http.request(options);
      }
      throw error;
    }
  }

  async delete(resource, options = {}) {
    return this.request('delete', resource, options);
  }

  async get(resource, options = {}) {
    return this.request('get', resource, options);
  }

  async post(resource, data, options = {}) {
    return this.request('post', resource, options, data);
  }

  async put(resource, data, options = {}) {
    return this.request('put', resource, options, data);
  }

  async *list(resource, options = {}) {
    let url = resource;
    while (true) {
      const response = await this.get(url, options);
      for (const object of response.bunq.objects) yield object;
      if (!response.bunq.pagination || !response.bunq.pagination.older) break;
      url = response.bunq.pagination.older;
    }
  }
}
