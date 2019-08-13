# bunq-session

[![npm version](https://badge.fury.io/js/bunq-session.svg)](https://badge.fury.io/js/bunq-session)

Basic bunq API client. Uses [bunq-http](https://github.com/robbertkl/bunq-http) and extends it with:

- automatic session management (initial key generation, device installation, login, auto reauthenticate after expiry)
- preconfigured production and sandbox hosts, including matching rate limit throttling
- installation/session persistence (provides a `FileStore` and `MemoryStore`, but you can always plug in your own)
- promise-based (async) functions for managed calls to the API
- async iterator for paginated resource walking

The async iterator allows you to use `for await...of` to loop over all (paginated) resources, automatically fetching new pages as you go. See the usage example below.

Please note this is not a full SDK; aside from the "login calls" (`installation`, `device-server`, `session-server`) the library does not know about any API endpoints or responses. In many cases, however, this is perfectly fine as you can just send/receive JSON following the documentation.

## Installation

```sh
npm install --save bunq-session
```

## Usage example

```JavaScript
import { BunqSession, FileStore } from 'bunq-session';

const bunq = new BunqSession('___my_bunq_sandbox_api_key___', {
  sandbox: true,
  store: new FileStore('./state.json'),
});

(async () => {
  try {
    const userId = await bunq.getUserId();
    for await (const account of bunq.list(`user/${userId}/monetary-account`)) {
      if (account.status !== 'ACTIVE') continue;
      console.log(`${account.description}: ${account.balance.currency} ${account.balance.value}`);
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
  }
})();
```

## Authors

- Robbert Klarenbeek, <robbertkl@renbeek.nl>

## License

This repo is published under the [MIT License](LICENSE).
