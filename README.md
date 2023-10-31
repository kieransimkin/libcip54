## libcip54

Libcip54 is part of the Smart NFT API - the best place to start if you're new to the API is the [Smart NFT Playground](https://nft-playground.dev). Alternatively you may consult the [Cardano Improvement Proposal](https://cips.cardano.org/cips/cip54)

Libcip54 provides the backend queries to the [DBSync](https://github.com/input-output-hk/cardano-db-sync) chain indexer in order to generate the initial page load data for a Smart NFT render, along with the necessary queries to respond to any additional API requests made by the NFT. 

Libcip54 is intended to be used with the [`<SmartNFTPortal>`](https://github.com/kieransimkin/smartnftportal) React component, which is responsible for rendering the NFT and providing the client-side Javascript API to the NFT running inside the `<iframe>`. These two packages operating in tandem make up the Smart NFT API.

The [Smart NFT Playground](https://nft-playground.dev/) includes a very simple backend using libcip54 to provide the endpoints needed to render Smart NFTs - I suggest consulting the [API section of that repository](https://github.com/kieransimkin/cip54-playground/tree/main/pages/api) 

## Usage

Install the library via npm:
```
npm install libcip54
```

Install the library via yarn:
```
yarn add libcip54
```

Initially you must connect to the Postgres database server running DBSync. Optionally you can also connect a redis client instance for caching. Then you must pass your Postgres client handle, and optionally the redis client handle to the init() function in libcip54 before you may use the API.

```js
import { init, getSmartImports } from "libcip54"
import pgCon from 'pg';
export default async () => { 
    const client = new pgCon.Client({connectionString: process.env.DBSYNC_URI});
    await client.connect();
    init('mainnet', client);
    const metadata={...}; // the NFT metadata as a javascript object
    const ownerAddr='Bech32 address of current owner';
    const tokenUnit='<policyID><assetNameHex>';
    const smartImports = await getSmartImports(metadata?.uses, ownerAddr, tokenUnit)
}
```

With a redis connection:

```js
import { init, getSmartImports } from "libcip54"
import { createClient } from 'redis';
import pgCon from 'pg';
export default async () => { 
    const redisClient = createClient({ url: process.env.REDIS_URI });
    await redisClient.connect();
    const pgClient = new pgCon.Client({connectionString: process.env.DBSYNC_URI});
    await pgClient.connect();
    init('mainnet', pgClient, process.env.IPFS_GATEWAY, process.env.ARWEAVE_GATEWAY, redisClient);
}
```

## Functions

In the API, when you see the term "unit" referring to a token - this just means the policyID followed by the asset name in hex encoding (with no separating character). 

#### `init: (networkId: 'mainnet' | 'testnet', connection: pgCon.Client, ipfsGateway: string, arweaveGateway: string, redisClient: redis.RedisClientType, redisPrefix: string, redisTTL: number): void`

You must call this function first with your database handle, otherwise all others fill fail.

The ipfsGateway and arweaveGateway strings specify http gateways for IPFS and arweave respectively.

redisPrefix allows you to specify a prefix for all libcip54 keys in the redis database.

redisTTL allows you to specify how long the redis cache will persist.

#### `getSmartImports: (featureTree: { libraries: { name: string; version: string; }[]; tokens: string[] | string; utxos: string[] | string; transactions: string[] | string; mintTx?: boolean; files?: boolean;}, walletAddr: string, tokenUnit: string) => Promise<any>;`

This is the main function you need to call to generate the initial page load data to populate the smartImports field for `<SmartNFTPortal>`.

#### `getTransactions(featureTree: { transactions: string[] | string}, walletAddr: string): Promise<object>`

This provides the transactions part of the initial smartImports data, as well as responding to any subsequent calls to getTransactions() in the front end API

#### `getTransactionsFromStake(stakeAddress: string, page?: number): Promise<any>`

This is a helper function which is used by the function above

#### `getTokens(featureTree: { tokens: string[] | string }, walletAddr: string): Promise<object>`

This provides the tokens part of the initial smartImports data, as well as responding to any subsequent calls to getTokens() in the front end API.

#### `getTokensFromStake(stakeAddress: string, page?: number): Promise<{unit: string;quantity: number;}[]>`

This is another helper function used by the function above.

#### `getUTXOs(featureTree: { utxos: string[] | string; }, walletAddr: string): Promise<any>`

This provides the UTXOs part of the initial smartImports 

#### `getUTXOsFromStake(stakeAddress: string, page?: number): Promise<{txHash: string; index: number; address: string; value: number; multiasset: { quantity: number; unit: string; }[]; datum: any | null;}[]>;`

This is a utility function used by the one above.

#### `getUTXOsFromAddr(baseAddress: string, page?: number): Promise<{ txHash: string; index: number; address: string; value: number; multiasset: { quantity: number; unit: string; }[]; datum: any | null;}[]>;`

This is a utility function used by getUTXOs()

#### `getUTXOsFromEither(stakeAddress: string | null, baseAddress: string | null, page?: number): Promise<{ txHash: string; index: number; address: string; value: number; multiasset: { quantity: number; unit: string; }[]; datum: any | null;}[]>;`

This is a utility function used by getUTXOs()

#### `getLibraries(featureTree: { libraries: { name: string; version: string; }[]; }): Promise<{ libraries: string[]; css: string[];}>;`

This provides the libraries part of the initial smartImports data - this is responsible for downloading the libraries from jscdn and creating data: URLs from them.

#### `getMetadata: (unit: string) => Promise<any>;`

Gets the NFT's metadata (either CIP25 or CIP68)

#### `getMintTx: (unit: string) => Promise<{ txHash: string; metadata: { key: string; json: object; }[];} | null>;`

Get the minting TX hash of a token

#### `getCIP68Metadata: (unit: string) => Promise<any>;`

Get the CIP68 metadata of a token.
