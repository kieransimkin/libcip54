## libcip54

Libcip54 is part of the Smart NFT API - the best place to start if you're new to the API is the [Smart NFT Playground](https://nft-playground.dev). Alternatively you may consult the [Cardano Improvement Proposal](https://cips.cardano.org/cips/cip54)

Libcip54 provides the backend queries to the [DBSync](https://github.com/input-output-hk/cardano-db-sync) chain indexer in order to generate the initial page load data for a Smart NFT render, along with the necessary queries to respond to any additional API requests made by the NFT. 

Libcip54 is intended to be used with the [`<SmartNFTPortal>`](https://github.com/kieransimkin/smartnftportal) React component, which is responsible for rendering the NFT and providing the client-side Javascript API to the NFT running inside the `<iframe>`. These two packages operating in tandem make up the Smart NFT API.

The [Smart NFT Playground](https://nft-playground.dev/) includes a very simple backend using libcip54 to provide the endpoints needed to render Smart NFTs - I suggest consulting the [API section of that repository](https://github.com/kieransimkin/cip54-playground/tree/main/pages/api) 

## Usage

First you must connect to the Postgres database server running DBSync. Then you must pass your Postgres client handle to the init() function in libcip54 before you may use the API.

```js
import { init, getSmartImports } from "libcip54"
import pgCon from 'pg';
export default async () => { 
    const client = new pgCon.Client({connectionString: process.env.DBSYNC_URI});
    client.connect();
    init('mainnet', pgClient);
    const metadata={...};
    const ownerAddr='Bech32 address of current owner';
    const tokenUnit='<policyID><assetNameHex>';
    const smartImports = await getSmartImports(metadata?.uses, ownerAddr, tokenUnit)
}
```

## Functions

In the API, when you see the term "unit" referring to a token - this just means the policyID followed by the asset name in hex encoding (with no separating character). 

#### `init: (networkId: 'mainnet' | 'testnet', connection: pgCon.Client): void`

You must call this function first with your database handle, otherwise all others fill fail.

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
