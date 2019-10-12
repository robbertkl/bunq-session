import bunqHttp from 'bunq-http';
import { rsa, pki } from 'node-forge';
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

    this.session = null;
  }

  async login() {
    if (!this.http.defaults.bunq.clientPrivateKey) {
      const clientPrivateKeyPem = await this.store.get('clientPrivateKey', async () => {
        const keyPair = await generateKeyPair({ bits: 2048 });
        return pki.privateKeyToPem(keyPair.privateKey);
      });
      this.http.defaults.bunq.clientPrivateKey = pki.privateKeyFromPem(clientPrivateKeyPem);
    }

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

    const createNewSession = async () => {
      const response = await this.http.post(
        'session-server',
        { secret: this.apiKey },
        { bunq: { token: this.installationToken } }
      );
      const userObject =
        'UserPerson' in response.bunq.objectsByType
          ? response.bunq.objectsByType.UserPerson[0]
          : response.bunq.objectsByType.UserCompany[0];
      return {
        token: response.bunq.objectsByType.Token[0].token,
        userId: userObject.id,
        userType: userObject.__type, // eslint-disable-line no-underscore-dangle
      };
    };

    if (this.persistSession) {
      if (this.session) {
        this.session = null;
        this.session = await createNewSession();
        await this.store.set('session', this.session);
      } else {
        this.session = await this.store.get('session', createNewSession);
      }
    } else {
      this.session = null;
      this.session = await createNewSession();
    }
    this.http.defaults.bunq.token = this.session.token;
  }

  async getUserId() {
    if (!this.session) await this.login();
    return this.session.userId;
  }

  async getUserType() {
    if (!this.session) await this.login();
    return this.session.userType;
  }

  async request(method, resource, options = {}, data = null) {
    if (!this.session) await this.login();

    options.method = method;
    options.url = resource;
    if (data) options.data = data;

    let response;
    try {
      response = await this.http.request(options);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        // Possibly expired session, retry once after creating a new session
        await this.login();
        response = await this.http.request(options);
      } else {
        throw error;
      }
    }

    return response;
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
