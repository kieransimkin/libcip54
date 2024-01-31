import pgCon from 'pg';
import axios from 'axios';
import punycode from 'punycode';
import { RedisClientType } from 'redis';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
let _networkId: number | null = null;
let _pgClient: pgCon.Client | null = null;
export const REFERENCE_TOKEN_LABEL = 100;
export const USER_TOKEN_LABEL = 222;
export const CIP25_LABEL = 721;
let IPFS_GATEWAY: string | null = null;
let ARWEAVE_GATEWAY: string | null = null;
let _redis: RedisClientType | null = null;
let _redisPrefix: string = '';
let _redisTTL: number = 3600;
import pJSON from '../package.json';
import multihash from 'multihashes';

/**
* @description This function initializes the values of several properties based on
* input parameters related to database and IPFS connectivity.
* 
* @param { string } networkId - The `networkId` input parameter determines whether
* to use mainnet or testnet credentials for connecting to external services like
* IPFS and Arweave.
* 
* @param { undefined } connection - The `connection` input parameter is used to
* establish a connection to a PostgreSQL database and return a client object for it.
* 
* @param { string } ipfsGateway - The `ipfsGateway` input parameter allows the user
* to provide a custom IPFS gateway endpoint for the app to communicate with the IPFS
* network.
* 
* @param { string } arweaveGateway - The `arweaveGateway` input parameter is an
* optional string that specifies the Arweave gateway to use for IPLD resolution.
* 
* @param {  } redis - The `redis` input parameter is an optional parameter that sets
* the Redis client instance to be used for storage.
* 
* @param { string } [redisPrefix=cip54:] - The `redisPrefix` input parameter specifies
* the prefix to use when storing data with Redis.
* 
* @param { number } [redisTTL=3600] - The `redisTTL` input parameter specifies the
* expiration time (in seconds) of data stored on Redis.
*/
export const init = (
  networkId: 'mainnet' | 'testnet',
  connection: pgCon.Client,
  ipfsGateway: string | null = null,
  arweaveGateway: string | null = null,
  redis: RedisClientType | null = null,
  redisPrefix: string = 'cip54:',
  redisTTL: number = 3600,
) => {
  _networkId = networkId === 'testnet' ? 0 : 1;
  _pgClient = connection;
  IPFS_GATEWAY = ipfsGateway;
  ARWEAVE_GATEWAY = arweaveGateway;
  _redis = redis;
  _redisPrefix = redisPrefix;
  _redisTTL = redisTTL;
};

/**
* @description This function checks if the `libcip54` client and network IDs are
* defined before allowing the code to run.
*/
const ensureInit = () => {
  if (!_pgClient || !_networkId) throw new Error('Libcip54 error - please initialize before use');
};

/**
* @description This function checks if a given key exists for the current session.
* It uses Redis to retrieve the value associated with the given key (using `_redis.get()`)
* and if no value is found or the value cannot be parsed as JSON (e.g., it contains
* invalid JSON), it returns null.
* 
* @param { string } name - The `name` input parameter is a string that is used as a
* key to retrieve data from the cache.
* 
* @returns { object } The output returned by this function is `null` if the cache
* entry for the given name does not exist or its value cannot be parsed as JSON.
*/
const checkCache = async (name: string) => {
  if (!_redis) return null;
  let cache: any = await _redis.get(_redisPrefix + ':' + name);
  if (!cache) return null;
  cache = JSON.parse(cache);
  return cache;
};

/**
* @description This function caches the given `data` under a unique key constructed
* from `name` using Redis' `setEx` method.
* 
* @param { string } name - The `name` input parameter is a string that specifies the
* key to be storedin the Redis cache.
* 
* @param { any } data - The `data` input parameter is passed through to the underlying
* `setEx()` method call within the function and represents the data to be stored.
* 
* @param { number } ttl - The `ttl` input parameter is an optional number that
* specifies the Time To Live (TTL) of the cached data. It sets the maximum amount
* of time that the data can be stored before it expires and needs to be re-cached.
*/
const doCache = async (name: string, data: any, ttl?: number) => {
  if (!_redis) return;
  await _redis.setEx(_redisPrefix + ':' + name, ttl ? ttl : _redisTTL, JSON.stringify(data));
};

/**
* @description This function fetches JSON data from a URL and stores it into Redis
* cache for future retrieval. It first checks if the URL is already cached using
* `checkCache`, if it is it returns the cached result immediately.
* 
* @param { string } url - The `url` parameter is the string identifier of a specific
* URL to be fetched and cached.
* 
* @returns { object } This function is aasyncronous and returns the JSON data fetched
* from the specified URL. It first checks if the data is available locally cached
* if not it makes the HTTP request using `fetch()` method then parse the response
* as JSON using `.json()`.
*/
const fetchCachedJson = async (url: string) => {
  if (!_redis) {
    const r = await fetch(url);
    return await r.json();
  }
  let cresult;
  if ((cresult = await checkCache('fetchCachedJson:' + url))) {
    return cresult;
  }
  cresult = await fetch(url);
  const json = await cresult.json();
  await doCache('fetchCachedJson:' + url, json);
  return json;
};

/**
* @description This function fetches a resource at a given URL and returns the fetched
* resource as a Blob. If the resource is already cached and matches the expected
* type (based on checkCache()), it returns the cached version instead of refetching
* from the URL.
* 
* @param { string } url - The `url` input parameter specifies the URL of the resource
* to fetch and returns a Blob object.
* 
* @returns { object } The output of the `fetchCachedBlob` function is a `Promise`
* that resolves to a `Blob` object. Here's a step-by-step breakdown of the output:
* 
* 1/ If the `_redis` variable is `undefined`, the function first fetches the resource
* at the provided URL using the `fetch` API.
* 2/ It then converts the response into a `Blob` object using the `.blob()` method.
* 3/ If there is a cache hit (i.e., the requested URL has been fetched before and
* the response is already cached), the function returns the cached response as a
* `Blob` object.
* 4/ Otherwise (i.e., there is no cache hit), the function fetches the resource from
* the URL using `fetch`, converts the response into an `arrayBuffer` using the
* `.arrayBuffer()` method of the `Blob` object.
* 5/ Finally ,the function returns the `arrayBuffer` as a `Promise` that resolves
* to a `Blob` object.
* 
* In simpler terms: If there's a cache hit (cached response is available for the
* requested URL), the function returns the cached response as-is (Step 3).
*/
const fetchCachedBlob = async (url: string) => {
  if (!_redis) {
    const r = await fetch(url);
    return await r.blob();
  }
  let cresult;
  if ((cresult = await checkCache('fetchCachedBlob:' + url))) {
    const b = Buffer.from(cresult.data);
    const bb = new Blob([b], { type: cresult.type });
    // return bb; TODO - Something not working here so disabling caching for blobs, for now
  }
  cresult = await fetch(url);
  const blob = await cresult.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await doCache('fetchCachedBlob:' + url, buffer.toJSON());
  return blob;
};

/**
* @description This function retrieves transactions for multiple stake addresses
* specified by a feature tree. It takes a feature tree with "transactions" property
* as a string or an array of strings and a wallet address. Then it loops through
* each transaction string or array element and gets the stake address from it.
* 
* @param { object } featureTree - The `featureTree` input parameter is a JavaScript
* object that contains an array of transaction identifiers or a single transaction
* identifier as a string.
* 
* @param { string } walletAddr - The `walletAddr` input parameter is used to specify
* the wallet address for which transactions are being retrieved.
* 
* @returns { Promise } The function `getTransactions` returns a Promise of an object
* where each key is a stake address and the value is an array of transactions for
* that stake address.
*/
export async function getTransactions(
  featureTree: { transactions: string[] | string },
  walletAddr: string,
): Promise<object> {
  const ret: any = {};
  let transactions = featureTree.transactions;
  if (typeof transactions === 'string') {
    transactions = [transactions];
  }
  for (const transaction of transactions) {
    let stakeAddress: string | null = transaction;
    if (stakeAddress === 'own') {
      stakeAddress = walletAddr;
    }
    stakeAddress = getStakeFromAny(stakeAddress);
    if (stakeAddress) {
      const txs = await getTransactionsFromStake(stakeAddress);
      ret[stakeAddress] = txs;
    }
  }
  return ret;
}

// Todo - detect full addresses rather than stake addresses and do a slightly different query for them
/**
* @description This function retrieves transactions from a specific stake address
* and returns them sorted by transaction ID descending and limited to the specified
* limit.
* 
* @param { string } stakeAddress - The `stakeAddress` input parameter passed to the
* function `getTransactionsFromStake` is a string value that represents the address
* of a staking wallet.
* 
* @param { number } [page=0] - The `page` input parameter limits the number of results
* returned from the query. It defaults to 0 and can take integers to skip over a
* subset of results.
* 
* @returns { Promise } The output of the `getTransactionsFromStake` function is an
* array of objects representing the transactions associated with a given stake
* address. Each object contains several properties:
* 
* 	- `hash`: The hash of the transaction as a hex string.
* 	- `out_sum`: The total output value of the transaction as a numeric string.
* 	- `fee`: The fee paid for the transaction as a numeric string.
* 	- `deposit`: The deposited amount of the transaction as a numeric string.
* 	- `size`: The size of the transaction as an integer.
* 	- `invalid_before`: The timestamp at which the transaction was invalidated before
* the current block as an integer.
* 	- `invalid_hereafter`: The timestamp at which the transaction becomes invalid
* after the current block as an integer.
* 	- `script_size`: The size of the script as an integer.
* 	- `block_no`: The block number where the transaction is located as an integer.
* 	- `time`: The time when the block was mined as a Unix timestamp (milliseconds)
* 	- `outputs`: An array of objects representing the outputs of the transaction.
* Each output object contains properties such as address and value.
* 	- `inputs`: An array of objects representing the inputs of the transaction.
*/
export async function getTransactionsFromStake(stakeAddress: string, page: number = 0): Promise<any> {
  ensureInit();
  if (!_pgClient) return [];
  let cresult;
  if ((cresult = await checkCache('getTransactionsFromStake:' + page + ':' + stakeAddress))) return cresult;
  let txs: any = await _pgClient.query(
    `
    SELECT 
    encode(tx.hash,'hex') AS hash, 
    tx.out_sum,
    tx.fee,
    tx.deposit,
    tx.size,
    tx.invalid_before,
    tx.invalid_hereafter,
    tx.script_size,
    block.block_no, 
    block.time,
    (
        SELECT json_agg(row_to_json(X))
        FROM (
            SELECT 
                to2.index,
                to2.address,
                to2.address_has_script,
                to2.value,
                to2.data_hash, 
                (
                    SELECT json_agg(row_to_json(X2)) FROM 
                        (
                            SELECT 
                                matx2.quantity, 
                                concat(encode(ma2.policy,'hex'), encode(ma2.name, 'hex')) AS unit
                            FROM ma_tx_out matx2 
                                LEFT JOIN multi_asset ma2 ON (ma2.id=matx2.ident) 
                            WHERE matx2.tx_out_id=to2.id
                        ) AS X2
                ) AS multiasset 
            FROM tx_out to2 WHERE tx_id=tx.id
        ) AS X
    ) AS outputs,
    (
        SELECT json_agg(row_to_json(X))
        FROM (
            SELECT 
                to2.index,
                to2.address,
                to2.address_has_script,
                to2.value,
                to2.data_hash,
                encode(tx2.hash, 'hex') AS hash,
                (
                    SELECT json_agg(row_to_json(X2)) FROM 
                    (
                        SELECT
                            matx2.quantity, 
                            concat(encode(ma2.policy,'hex'), encode(ma2.name, 'hex')) AS unit
                        FROM ma_tx_out matx2
                            LEFT JOIN multi_asset ma2 ON (ma2.id=matx2.ident)
                        WHERE matx2.tx_out_id=to2.id
                    ) AS X2
                ) AS multiasset 
            FROM tx_in 
                LEFT JOIN tx_out to2 ON to2.tx_id=tx_in.tx_out_id AND to2.index=tx_in.tx_out_index 
                LEFT JOIN tx tx2 ON tx2.id=to2.tx_id
            WHERE tx_in.tx_in_id=tx.id
        ) AS X
    ) AS inputs
FROM tx
    JOIN tx_out         ON (tx.id = tx_out.tx_id)
    JOIN stake_address s1  ON (s1.id = tx_out.stake_address_id)
    JOIN block          ON (block.id = tx.block_id)
WHERE valid_contract = 'true'
    AND (s1.view = $1::TEXT)
GROUP BY tx.id, block.id
ORDER BY tx.id DESC
LIMIT 20
OFFSET $2
    `,
    [stakeAddress, 20 * page],
  );
  txs = txs.rows;
  await doCache('getTransactionsFromStake:' + page + ':' + stakeAddress, txs);
  return txs;
}

/**
* @description This function retrieves the Ada handle associated with a given wallet
* address. It first checks if the address has an existing stake entry and then queries
* the database for the multi-asset information linked to that address using PostgreSQL
* SQL queries.
* 
* @param { string } walletAddr - The `walletAddr` input parameter specifies the
* address of a Cardano wallet to look up and retrieve the corresponding Ada handle.
* 
* @returns { Promise } This function takes a wallet address as input and returns a
* hex-encoded Ada handle or null if no matching handle is found. Here's a breakdown
* of the function:
* 
* 1/ It checks if the function has been initialized. If not yet initialized then it
* does so now.
* 2/ If there is a cache hit (i.e., a result for the given address was already cached)
* it returns the cached result directly.
* 3/ Else (or if there's no cache hit), it fetches data from the PostgreSQL database
* by running a SELECT statement with joins on multiple tables to retrieve information
* about the specified wallet address and the corresponding Ada handle(s). The query
* includes filters to ensure that only Ada assets with a specific policy and a valid
* contract are considered.
* 4/ After retrieving the results from the database (as a JSON array), it returns a
* hex-encoded Ada handle if at least one match was found. If no match is found (i.e.,
* there is no Ada asset with the specified policy and a valid contract), then null
* is returned.
* 5/ If the function successfully fetched data from the database but there are
* multiple matching handles (unlikely scenario), it caches the result to avoid this
* edge case scenario.
* 
* In other words: If an Ada wallet address exists for which the policy is
* f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a and has a valid contract
* it will return that handle.
*/
export async function getAdaHandleFromAddress(walletAddr: string): Promise<object | null> {
  ensureInit();
  if (!_pgClient) return [];
  let cresult;
  if ((cresult = await checkCache('getAdaHandleFromAddress:' + walletAddr))) return cresult;

  const stake = getStakeFromAny(walletAddr);
  if (!stake) return null;
  let handle: any = await _pgClient.query(
    `
    SELECT 
         encode(multi_asset.name, 'hex') AS handle
    FROM multi_asset 
        JOIN ma_tx_out      ON (ma_tx_out.ident = multi_asset.id) 
        JOIN tx_out         ON (tx_out.id = ma_tx_out.tx_out_id)
        JOIN utxo_view      ON (utxo_view.id = ma_tx_out.tx_out_id) 
        JOIN stake_address  ON (stake_address.id = utxo_view.stake_address_id)
        JOIN tx             ON (tx.id = utxo_view.tx_id)
    WHERE (stake_address.view = $1::TEXT) 
            AND encode(multi_asset.policy,'hex')='f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a'
            AND tx.valid_contract = 'true'
    GROUP BY encode(multi_asset.name, 'hex')
	  LIMIT 1;
    `,
    [stake],
  );
  handle = handle?.rows[0]?.handle;
  if (handle) {
    handle = hexToAscii(handle);
    handle = punycode.toUnicode(handle);
    await doCache('getAdaHandleFromAddress:' + stake, handle);
    return handle;
  } else {
    return null;
  }
}

/**
* @description This function takes a feature tree with a list of tokens and a wallet
* address as inputs and returns an object where each key is a stake address and the
* value is an array of token assets for that address.
* 
* @param { object } featureTree - The `featureTree` input parameter is an object
* with a `tokens` property that contains an array of strings representing the token
* addresses or a single string containing multiple token addresses separated by commas.
* 
* @param { string } walletAddr - The `walletAddr` parameter is used to specify the
* wallet address that should be used to retrieve tokens from stake addresses specified
* as "own" during iteration through feature tree.
* 
* @returns { Promise } The output returned by this function is an object with the
* form `{Address1: Asset1., Address2: Asset2., ...}`. The `Asset`s are the tokens
* held by the addresses specified.
*/
export async function getTokens(featureTree: { tokens: string[] | string }, walletAddr: string): Promise<object> {
  const ret: any = {};
  let tokens = featureTree.tokens;
  if (typeof tokens === 'string') {
    tokens = [tokens];
  }
  for (const token of tokens) {
    let stakeAddress: string | null = token;
    if (stakeAddress === 'own') {
      stakeAddress = walletAddr;
    }
    stakeAddress = getStakeFromAny(stakeAddress);
    if (stakeAddress) {
      const assets = await getTokensFromStake(stakeAddress);
      ret[stakeAddress] = assets;
    }
  }
  return ret;
}

// Todo - detect full addresses rather than stake addresses and do a slightly different query for them

/**
* @description This function gets tokens associated with an address or stake address
* by checking the Stellar blockchain and returning a list of token-quantity pairs
* or `null` if no matches are found.
* 
* @param { string } address - The `address` input parameter specifies the address
* to look up tokens for.
* 
* @param { number } [page=0] - The `page` input parameter specifies the current page
* of results to retrieve.
* 
* @returns { Promise } This function takes a string `address` and returns an array
* of objects with two properties: `unit` and `quantity`. The objects represent tokens
* associated with the given address.
*/
export async function getTokensFromAny(
  address: string,
  page: number = 0,
): Promise<{ unit: string; quantity: number }[] | null> {
  let stakeAddress: string | null = address;

  stakeAddress = getStakeFromAny(stakeAddress);
  if (stakeAddress) {
    return await getTokensFromStake(stakeAddress, page);
  }
  return null;
}

/**
* @description This function retrieves a list of token balances for a given stake
* address from the multi-asset table and returns an array of objects with `unit` and
* `quantity` properties.
* 
* @param { string } stakeAddress - The `stakeAddress` parameter is used to filter
* the results by the stake address associated with each asset.
* 
* @param { number } [page=0] - The `page` input parameter is an optional integer
* parameter that specifies the current page of results to retrieve from the database.
* 
* @param { boolean } policies - The `policies` input parameter allows the function
* to filter the results by policy.
* 
* @returns { Promise } The output of the function `getTokensFromStake` is an array
* of objects with two properties: `unit` and `quantity`. The `unit` property is a
* hex-encoded string representing the multi-asset policy or name of the token
* associated with the stake address.
*/
export async function getTokensFromStake(
  stakeAddress: string,
  page: number = 0,
  policies: boolean = false,
): Promise<{ unit: string; quantity: number }[]> {
  ensureInit();
  if (!_pgClient) return [];
  let cresult;
  let defaultGroup = "GROUP BY concat(encode(multi_asset.policy, 'hex'), encode(multi_asset.name, 'hex'))";
  let defaultSelect = "concat(encode(multi_asset.policy, 'hex'), encode(multi_asset.name, 'hex')) AS unit";
  let defaultCache = 'getTokensFromStake';
  if (policies) {
    defaultGroup = "GROUP BY encode(multi_asset.policy, 'hex')";
    defaultSelect = "encode(multi_asset.policy, 'hex') AS UNIT, ";
    defaultCache = 'getUniquePoliciesFromStake';
  }
  if ((cresult = await checkCache(defaultCache + ':' + page + ':' + stakeAddress))) return cresult;
  let assets: any = await _pgClient.query(
    `
    SELECT 
        ${defaultSelect}, 
        sum(ma_tx_out.quantity) as quantity
    FROM multi_asset 
        JOIN ma_tx_out      ON (ma_tx_out.ident = multi_asset.id) 
        JOIN tx_out         ON (tx_out.id = ma_tx_out.tx_out_id)
        JOIN utxo_view      ON (utxo_view.id = ma_tx_out.tx_out_id) 
        JOIN stake_address  ON (stake_address.id = utxo_view.stake_address_id)
        JOIN tx             ON (tx.id = utxo_view.tx_id)
    WHERE (stake_address.view = $1::TEXT)
            AND tx.valid_contract = 'true'
    ${defaultGroup}
    `,
    [stakeAddress],
  );
  assets = assets.rows;
  await doCache(defaultCache + ':' + page + ':' + stakeAddress, assets);
  return assets;
}

/**
* @description This function retrieves the unique policies (i.e., tokens) held by a
* specific stake address and returns an array of objects containing the unit and
* quantity of each policy.
* 
* @param { string } stakeAddress - The `stakeAddress` input parameter specifies the
* address of a stake (e.g., a Cosmos zone) for which to retrieve unique policies.
* 
* @param { number } [page=0] - The `page` input parameter is used to specify the
* starting point of the query results. It determines which range of data to retrieve
* from the staking pool.
* 
* @returns { Promise } This function takes a `stakeAddress` parameter and returns a
* promise that resolves to an array of objects containing two properties each: `unit`
* and `quantity`.
*/
export async function getUniquePoliciesFromStake(
  stakeAddress: string,
  page: number = 0,
): Promise<{ unit: string; quantity: number }[]> {
  return await getTokensFromStake(stakeAddress, page, true);
}

/**
* @description This function retrieves the list of tokens associated with a specific
* policy and returns them as an array of objects with "unit" and "quantity" properties.
* 
* @param { string } policyId - The `policyId` input parameter specifies the identifier
* of the policy for which to retrieve tokens.
* 
* @param { number } [page=0] - The `page` input parameter is an optional parameter
* that specifies which page of results to return. It defaults to 0 if not provided.
* 
* @returns { Promise } This function returns a list of objects with two properties:
* "unit" and "quantity". The "unit" property is a concatenation of the hex-encoded
* policy ID and name of the token. The "quantity" property is the sum of all
* transactions for that token.
*/
export async function getTokensFromPolicy(policyId: string, page: number = 0): Promise<any> {
  ensureInit();
  if (!_pgClient) return [];
  let cresult;
  if ((cresult = await checkCache('getTokensFromPolicy:' + page + ':' + policyId))) return cresult;
  let tokens: any = await _pgClient.query(
    `
    SELECT 
    concat(encode(multi_asset.policy, 'hex'), encode(multi_asset.name, 'hex')) AS unit,
	sum(quantity)::TEXT as "quantity"
FROM multi_asset 
join ma_tx_mint on (ma_tx_mint.ident=multi_asset.id)
WHERE (encode(multi_asset.policy,'hex') = $1::TEXT)
GROUP BY concat(encode(multi_asset.policy, 'hex'), encode(multi_asset.name, 'hex'))
HAVING sum(quantity)>0
ORDER BY sum(quantity) DESC
    `,
    [policyId],
  );
  tokens = tokens.rows;
  await doCache('getTokensFromPolicy:' + page + ':' + policyId, tokens);
  return tokens;
}

/**
* @description This is an Node.js asynchronous function that fetches the list of
* policy holders for a set of specified policies. It takes a policy ID or an array
* of policy IDs and returns an array of objects containing information about the
* quantity and stake address for each holder. The function first checks if the result
* is cached and retrieves it from cache if available. If not caching or no policy
* ID is provided returns an empty array.
* 
* @param { array } policyId - The `policyId` parameter is an array of policy IDs or
* a single policy ID that specifies which policy(ies) to query for policy holders.
* 
* @param { number } [page=0] - The `page` input parameter limits the results of the
* query to a specific slice of the total result set. In this case it takes an optional
* parameter `page`, which determines how much data will be returned.
* 
* @returns { Promise } Based on the code provided:
* 
* The `getPolicyHolders` function takes two arguments: `policyId` (either a string
* or an array of strings) and `page` (an optional integer representing the page
* number). The function returns a promise that resolves to an array of objects
* containing the following properties:
* 
* 1/ `quantity`: the total quantity of the specified asset held by each address.
* 2/ `stake`: the staking view associated with each address.
* 
* The function first checks the cache for existing results and fetches them if they
* exist. If no cache hits occur or the function is called for the first time with a
* new set of policy IDs/pages combinations then it will perform the database query.
*/
export async function getPolicyHolders(policyId: string | string[], page: number = 0): Promise<any> {
  ensureInit();
  if (!_pgClient) return [];
  let cresult, policies;
  const count = 20;
  if (typeof policyId === 'string') {
    policies = [policyId];
  } else {
    policies = policyId;
  }
  if ((cresult = await checkCache('getPolicyHolders:' + page + ':' + policies.join(':')))) return cresult;
  let holders = null;
  holders = await _pgClient.query(
    `
  SELECT 
    sum(ma_tx_out.quantity) AS quantity,
    stake_address.view as stake
  FROM multi_asset 
  JOIN ma_tx_out      ON (ma_tx_out.ident = multi_asset.id)
  JOIN tx_out         ON (tx_out.id = ma_tx_out.tx_out_id)
  JOIN tx             ON (tx.id = tx_out.tx_id)
  JOIN utxo_view      ON (utxo_view.id = ma_tx_out.tx_out_id)
  JOIN stake_address  ON (stake_address.id = tx_out.stake_address_id)
  WHERE valid_contract = 'true' and
    encode(multi_asset.policy ,'hex') = ANY($1::TEXT[])
  GROUP BY stake_address.id
  ORDER BY sum(ma_tx_out.quantity) desc
  LIMIT $2
  OFFSET $3
  `,
    [policies, count, count * page],
  );
  holders = holders.rows;
  await doCache('getPolicyHolders:' + page + ':' + policies.join(':'), holders);
  return holders;
}

/**
* @description This function retrieves the top token holders for a specific asset
* unit and returns an array of objects containing the holder's address and stake
* information. It first checks if the data is cached and returns the cached result
* if available. If not cached it executes a PostgreSQL query to retrieve the top
* holders based on the amount of tokens held and their order is descending.
* 
* @param { string } unit - The `unit` input parameter specifies the specific asset
* for which to retrieve the top token holders.
* 
* @param { number } [page=0] - The `page` input parameter controls the subset of
* token holders that are returned. It specifies which portion of the total list of
* token holders should be retrieved for a given request. In other words，the page
* parameter limits the result set to a specific range of token holders，with the size
* of that range being determined by the `count` parameter.
* 
* @returns { Promise } This function returns a list of objects containing information
* about token holders. Each object includes properties such as address and stake
* (the amount of tokens held), as well as sum(quantity) (the total amount of tokens
* held). The output is organized by group (address and view) and sorted by the sum
* of quantities held.
*/
export async function getTokenHolders(unit: string, page: number = 0): Promise<any> {
  ensureInit();
  if (!_pgClient) return [];
  let cresult;
  const count: number = 20;
  if ((cresult = await checkCache('getTokenHolders:' + page + ':' + unit))) return cresult;
  let holders = null;
  holders = await _pgClient.query(
    `
  SELECT address, view as stake, sum(quantity) as quantity from ma_tx_out
    JOIN tx_out txo ON (txo.id = ma_tx_out.tx_out_id)
    JOIN tx ON (tx.id = txo.tx_id)
    JOIN stake_address on (stake_address.id = txo.stake_address_id)
    LEFT JOIN tx_in txi ON (txo.tx_id = txi.tx_out_id)
    AND (txo.index = txi.tx_out_index)
  WHERE txi IS NULL
    AND tx.valid_contract = 'true'
  AND ident=(SELECT id FROM multi_asset ma WHERE (encode(policy, 'hex') || encode(name, 'hex')) = $1::TEXT)
  GROUP BY address, view
  ORDER BY sum(ma_tx_out.quantity) desc
  LIMIT $2::BIGINT
  OFFSET $3::BIGINT
  `,
    [unit, count, count * page],
  );
  holders = holders.rows;
  await doCache('getTokenHolders:' + page + ':' + unit, holders);
  return holders;
}

/**
* @description This function fetches and aggregates UTXOs for multiple stakes from
* a feature tree.
* 
* @param { object } featureTree - The `featureTree` input parameter is an object
* with a property `utxos` that can be either a string or an array of strings
* representing the UTXOs.
* 
* @param { string } walletAddr - The `walletAddr` parameter is used to specify the
* wallet address that should be used to retrieve UTXOs for each stake address.
* 
* @returns { Promise } This function takes a feature tree with an `utxos` field
* containing either a single string or an array of strings representing the utxos
* owned by a staking address (or "own" if the address is unspecified), and a wallet
* address.
*/
export async function getUTXOs(featureTree: { utxos: string[] | string }, walletAddr: string): Promise<any> {
  const ret: any = {};
  let utxos = featureTree.utxos;
  if (typeof utxos === 'string') {
    utxos = [utxos];
  }
  for (const utxo of utxos) {
    let stakeAddress: string | null = utxo;
    if (stakeAddress === 'own') {
      stakeAddress = walletAddr;
    }
    stakeAddress = getStakeFromAny(stakeAddress);
    if (stakeAddress) {
      const utres = await getUTXOsFromStake(stakeAddress);
      ret[stakeAddress] = utres;
    }
  }
  return ret;
}

// Todo - detect full addresses rather than stake addresses and do a slightly different query for them
/**
* @description This function fetches Unspent Transaction Outputs (UTXOs) associated
* with a given stake address using the blockchain's RPC interface.
* 
* @param { string } stakeAddress - The `stakeAddress` parameter is used to specify
* the staking address for which UTXO information is being requested.
* 
* @param { number } [page=0] - The `page` input parameter specifies the current page
* of UTXOs to retrieve.
* 
* @returns { Promise } This function takes a `stakeAddress` and returns an array of
* objects containing information about UTXOs (unspent transaction outputs) associated
* with that address.
*/
export async function getUTXOsFromStake(
  stakeAddress: string,
  page: number = 0,
): Promise<
  {
    txHash: string;
    index: number;
    address: string;
    value: number;
    multiasset: { quantity: number; unit: string }[];
    datum: any | null;
  }[]
> {
  ensureInit();
  if (!_pgClient) return [];

  return await getUTXOsFromEither(stakeAddress, null, page);
}

/**
* @description This function fetches UTXO data (txHash + index + address + value +
* multiasset quantities and unit) for a given base address using promises and Page
* Golomb cursors on top of Postgres.
* 
* @param { string } baseAddress - The `baseAddress` input parameter is used to specify
* the address from which to start fetching UTXOs.
* 
* @param { number } [page=0] - The `page` input parameter specifies which page of
* UTXOs to retrieve.
* 
* @returns { Promise } The output of the `getUTXOsFromAddr` function is an array of
* objects containing information about UTXOs associated with the provided base address.
*/
export async function getUTXOsFromAddr(
  baseAddress: string,
  page: number = 0,
): Promise<
  {
    txHash: string;
    index: number;
    address: string;
    value: number;
    multiasset: { quantity: number; unit: string }[];
    datum: any | null;
  }[]
> {
  ensureInit();
  if (!_pgClient) return [];

  return await getUTXOsFromEither(null, baseAddress, page);
}

/**
* @description This function fetches UTXO data from a PostgreSQL database based on
* the given parameters: `stakeAddress`, `baseAddress`, and `page`.
* 
* @param { string } stakeAddress - The `stakeAddress` input parameter specifies the
* stake address of the utxos being retrieved.
* 
* @param { string } baseAddress - The `baseAddress` parameter is an optional input
* that specifies a secondary address to filter the UTXOs by.
* 
* @param { number } [page=0] - The `page` parameter is an optional integer input
* that specifies which page of results to return.
* 
* @returns { Promise } This function returns an array of objects with the following
* properties:
* 
* 	- `txHash`: the hash of the transaction
* 	- `index`: the index of the output within the transaction
* 	- `address`: the address of the output (either the stake address or the base address)
* 	- `value`: the value of the output
* 	- `multiasset`: an array of objects with the following properties:
* 	+ `quantity`: the quantity of the asset
* 	+ `unit`: the unit of the asset (represented as a hex-encoded string)
* 	- `datum`: either null or an object with the `value` and `id` properties.
* 
* The output is returned as a promise that resolves to the array of objects.
*/
export async function getUTXOsFromEither(
  stakeAddress: string | null,
  baseAddress: string | null,
  page: number = 0,
): Promise<
  {
    txHash: string;
    index: number;
    address: string;
    value: number;
    multiasset: { quantity: number; unit: string }[];
    datum: any | null;
  }[]
> {
  ensureInit();
  if (!_pgClient) return [];
  let cresult;
  if ((cresult = await checkCache('getUTXOsFromEither:' + page + ':' + stakeAddress + ':' + baseAddress)))
    return cresult;
  let filter = '(stake_address.view = $1::TEXT)';
  let field = stakeAddress;
  if (baseAddress) {
    filter = '(tx_out.address = $1::TEXT)';
    field = baseAddress;
  }
  let utres: any = await _pgClient.query(
    `
      SELECT 
          encode(tx.hash,'hex') as txHash, 
          tx_out."index", 
          tx_out.address, 
          tx_out.value,
          (
              SELECT json_agg(row_to_json(X2)) FROM 
              (
                  SELECT
                      matx2.quantity, 
                      concat(encode(ma2.policy,'hex'), encode(ma2.name, 'hex')) AS unit
                  FROM ma_tx_out matx2
                      LEFT JOIN multi_asset ma2 ON (ma2.id=matx2.ident)
                  WHERE matx2.tx_out_id=tx_out.id
              ) AS X2
          ) AS multiasset,
          CASE WHEN d1.value IS NOT NULL THEN d1.value WHEN d2.value IS NOT NULL THEN d2.value ELSE NULL END datum
      FROM utxo_view
        JOIN tx_out         ON (tx_out.id = utxo_view.id)
        JOIN stake_address  ON (stake_address.id = utxo_view.stake_address_id)
        JOIN tx             ON (tx.id = utxo_view.tx_id)
        LEFT JOIN datum d1  ON (d1.hash = tx_out.data_hash)
        LEFT JOIN datum d2  ON (d2.id = tx_out.inline_datum_id)
          WHERE ${filter}
              AND tx.valid_contract = 'true'`,
    [field],
  );
  utres = utres.rows;
  await doCache('getUTXOsFromEither:' + page + ':' + stakeAddress + ':' + baseAddress, utres);
  return utres;
}

/**
* @description This function fetches libraries' information from CDN and returns an
* object with two properties: "libraries" and "css". It takes a feature tree as an
* argument and uses it to determine which files to download from the CDN based on
* various conditions.
* 
* @param { object } featureTree - The `featureTree` input parameter is an object
* containing information about the desired libraries.
* 
* @returns { Promise } The function `getLibraries` returns an object with two
* properties: `libraries` and `css`. The `libraries` property is an array of strings
* containing the raw source code of each library file (in application/javascript
* format), while the `css` property is an array of strings containing the raw source
* code of each CSS file.
*/
export async function getLibraries(featureTree: {
  libraries: { name: string; version: string }[];
}): Promise<{ libraries: string[]; css: string[] }> {
  const ret: { libraries: string[]; css: string[] } = { libraries: [], css: [] };
  for (const library of featureTree.libraries) {
    const result = await fetchCachedJson(
      'https://api.cdnjs.com/libraries/' + library.name + '/' + library.version + '?fields=name,version,files',
    );
    const files = result.files;
    const name = library.name;
    for (const file of files) {
      if (
        !file.includes('.min.') || // skip file if it doesn't include .min
        (name === 'three.js' && file.includes('.module.')) || // for three.js don't load the module version
        (name === 'phaser' && file.includes('-ie9')) || // for phaser exclude a few files which don't work
        (name === 'phaser' && file.includes('.esm.')) ||
        (name === 'phaser' && file.includes('arcade-physics'))
      ) {
        continue;
      }
      const url = 'https://cdnjs.cloudflare.com/ajax/libs/' + library.name + '/' + library.version + '/' + file;
      const fresult = await fetchCachedBlob(url);
      const ab = await fresult.arrayBuffer();
      const ia = new Uint8Array(ab);
      const tresult = new TextDecoder().decode(ia);
      const mType = fresult.type.split(';')[0];
      const librarySrc = 'data:' + mType + ',' + encodeURIComponent(tresult);
      if (mType.toLowerCase() === 'application/javascript') {
        ret.libraries.push(librarySrc);
      } else if (mType.toLowerCase() === 'text/css') {
        ret.css.push(librarySrc);
      }
    }
  }
  return ret;
}

/**
* @description This function retrieves metadata for a given NFT unit (string) by
* querying a blockchain using two different methods depending on the label of the
* NFT. If the NFT has a CIP25 label , the function calls the `getMintTx` to retrieve
* the mint transaction and extract the metadata from it.
* 
* @param { string } unit - The `unit` input parameter is a string that represents a
* cryptographic identifier (CID) of an NFT or a CIP68 reference token.
* 
* @returns { Promise } The `getMetadata` function returns a promise of an `any` type
* that resolves to a JSON object containing NFT metadata for a given unit (a
* cryptocurrency unit).
*/
export const getMetadata = async (unit: string): Promise<any> => {
  if (!unit || unit.length < 1) return null;
  const { label, name, policyId, assetName } = fromUnit(unit);
  let metadata = null;
  if (!label || !labelIsCIP68(label)) {
    const mintTx = await getMintTx(unit);
    if (mintTx && mintTx.metadata && typeof mintTx.metadata === 'object') {
/**
* @description The provided code filters the `mintTx.metadata` object using the
* `filter()` method and a function that checks if the current element's `key` property
* is equal to `CIP25_LABEL`.
* 
* @param { any } m - The `m` input parameter is the current element being iterated
* over during iteration of the `metadata` array.
*/
      const nftMetadata: any = mintTx.metadata.filter((m: any) => m.key === CIP25_LABEL)[0]?.json;
      const policyMetadata = nftMetadata ? nftMetadata[policyId] : null;
      if (policyMetadata && policyMetadata[Buffer.from(assetName || '', 'hex').toString()]) {
        metadata = policyMetadata[Buffer.from(assetName || '', 'hex').toString()];
      } else if (policyMetadata && policyMetadata[assetName || '']) {
        metadata = policyMetadata[assetName || ''];
      } else {
        metadata = null;
      }
    } else {
      metadata = null;
    }
  } else {
    metadata = await getCIP68Metadata(toUnit(policyId, name, REFERENCE_TOKEN_LABEL));
  }
  return metadata;
};

/**
* @description This function fetches the metadata for a given unit of a multi-asset
* contract using the contract's policy and name as filters. It checks the cache first
* before querying the database to retrieve the relevant information.
* 
* @param { string } unit - The `unit` input parameter specifies the specific multi-asset
* minted transaction for which to retrieve information.
* 
* @returns { Promise } This function returns a JavaScript object with two properties:
* `txHash` and `metadata`. The `txHash` property contains the hex-encoded hash of
* the mint transaction metadata. The `metadata` property is an array of JSON objects
* representing the metadata associated with the mint transaction.
* 
* The output is always a non-null object except when the `unit` parameter passed to
* the function is "Un-minted".
*/
export const getMintTx = async (
  unit: string,
): Promise<{ txHash: string; metadata: { key: string; json: object }[] } | null> => {
  ensureInit();
  if (unit === 'Un-minted') {
    return {
      txHash: '',
      metadata: [],
    };
  }
  if (!_pgClient) return null;
  let cresult;
  if ((cresult = await checkCache('getMintTx:' + unit))) return cresult;

  const mintTx = await _pgClient.query(
    `
    SELECT 
        encode(tx.hash, 'hex') as txHash,
        (
            SELECT json_agg(row_to_json(X2)) FROM 
            (
                SELECT
                    key,
                    json
                FROM tx_metadata
                WHERE tx_metadata.tx_id=tx.id
            ) AS X2
        ) AS metadata
    FROM multi_asset 
        JOIN ma_tx_mint      ON (ma_tx_mint.ident = multi_asset.id) 
        JOIN tx             ON (tx.id = ma_tx_mint.tx_id)
    WHERE  ma_tx_mint.quantity>0 AND
            tx.valid_contract = 'true' AND
            policy = decode($1::TEXT, 'hex') AND
            name = decode($2::TEXT, 'hex')
    ORDER BY tx.id desc LIMIT 1
    `,
    [unit.substring(0, 56), unit.substring(56)],
  );
  if (!mintTx.rows.length) return null;
  await doCache('getMintTx:' + unit, mintTx.rows[0]);
  return mintTx.rows[0];
};

/**
* @description This function retrieves the CIP-68 metadata for a given unit by
* querying the PostgreSQL database using GraphQL. It checks if the metadata is cached
* and if so returns the cached value.
* 
* @param { string } unit - The `unit` input parameter is a string that represents
* the identifier of a CIP-68 unit.
* 
* @returns { Promise } The `getCIP68Metadata` function returns a JSON object
* representing the metadata for a given unit. The metadata includes fields from the
* contract and the transaction that created the unit. The function first checks if
* the data is available cache and returns it if found. If not found it retrieves the
* data from the database and caches it before returning.
* 
* The output of this function is a JSON object with the metadata for a given unit.
* For example:
* ```
* {
*   "name": "Test Contract",
*   "version": "1.0",
*   "title": "This is a test contract",
*   "description": "A contract to test the CIP68 workflow"
* }
* ```
* The output contains fields such as name', version", "title" and "description".
*/
export const getCIP68Metadata = async (unit: string): Promise<any> => {
  ensureInit();
  if (!_pgClient) return [];
  let cresult;
  if ((cresult = await checkCache('getCIP68Metadata:' + unit))) return cresult;
  try {
    let datum: any = await _pgClient.query(
      `
      SELECT           
          CASE WHEN d1.value IS NOT NULL THEN d1.value WHEN d2.value IS NOT NULL THEN d2.value ELSE NULL END datum
      FROM multi_asset
          JOIN ma_tx_out      ON (ma_tx_out.ident = multi_asset.id)
          JOIN tx_out         ON (tx_out.id = ma_tx_out.tx_out_id)
          JOIN tx             ON (tx.id = tx_out.tx_id)
          JOIN utxo_view      ON (utxo_view.id = ma_tx_out.tx_out_id) 
          LEFT JOIN datum d1  ON (d1.hash = tx_out.data_hash)
          LEFT JOIN datum d2  ON (d2.id = tx_out.inline_datum_id)
      WHERE valid_contract = 'true'
          AND policy = decode($1::TEXT, 'hex')
          AND name = decode($2::TEXT, 'hex')
          LIMIT 1
      `,
      [unit.substring(0, 56), unit.substring(56)],
    );

    datum = datum?.rows[0]?.datum;

    if (!datum) return null;

/**
* @description This function takes a list of objects (in CBOR format) and recursively
* parses each object as a JSON map or list.
* 
* @param { any } list - The `list` input parameter is an array of JSON objects to
* be parsed as CBOR.
* 
* @returns { any } The `parseCborJsonList` function takes a list of objects as input
* and returns an array of values parsed from each object using the following logic:
* 
* 1/ If the object has a `.map` property (i.e., it's a CBOR map), the function calls
* `parseCborJsonMap` to parse the map and returns its output as the value for that
* object.
* 2/ If the object has a `.bytes` property (i.e., it's a CBOR binary data), the
* function creates a new Buffer from the hex-encoded string and converts it to a
* JSON string using `Buffer.toString()`. The result is returned as the value for
* that object.
* 3/ If the object has a `.list` property (i.e., it's another list of objects), the
* function calls `parseCborJsonList` recursively on the list and returns its output
* as the value for that object.
* 
* The output of this function is an array of parsed values for each input object.
*/
    const parseCborJsonList = (list: any): any => {
      const ret = [];
      for (const item of list) {
        let value = null;
        if (item.map) {
          value = parseCborJsonMap(item.map);
        } else if (item.bytes) {
          value = Buffer.from(item.bytes, 'hex').toString();
        } else if (item.list) {
          value = parseCborJsonList(item.list);
        }
        ret.push(value);
      }
      return ret;
    };

/**
* @description This function takes a CBOR-encoded JSON object and parse it into a
* JavaScript object.
* 
* @param { any } map - The `map` input parameter is a JavaScript object that contains
* the CBOR map to be parsed.
* 
* @returns { any } This function takes a JSON object `map` and returns another JSON
* object with the same keys as `map`, but where each value is either a string (if
* the original value was a binary data) or an recursively formatted JSON object (if
* the original value was a list or map).
* 
* In other words.
*/
    const parseCborJsonMap = (map: any): any => {
      const ret: any = {};
      for (const field of map) {
        let value = null;
        if (field.v.bytes) {
          value = Buffer.from(field.v.bytes, 'hex').toString();
        } else if (field.v.list) {
          value = parseCborJsonList(field.v.list);
        } else if (field.v.map) {
          value = parseCborJsonMap(field.v.map);
        }
        ret[Buffer.from(field.k.bytes, 'hex').toString()] = value;
      }
      return ret;
    };

    const metadata: any = {};
    for (const field of datum.fields[0].map) {
      let value = '';
      if (field.v.bytes) {
        value = Buffer.from(field.v.bytes, 'hex').toString();
      } else if (field.v.list) {
        value = parseCborJsonList(field.v.list);
      } else if (field.v.map) {
        value = parseCborJsonMap(field.v.map);
      }

      metadata[Buffer.from(field.k.bytes, 'hex').toString()] = value;
    }
    await doCache('getCIP68Metadata:' + unit, metadata);
    return metadata;
  } catch (e) {
    return false;
  }
};
/**
* @description This function retrieves file metadata and returns an array of objects
* containing information about the files. It accepts parameters such as unit and
* optional metadata and performs operations on them using functions like `getMetadata`
* and `getFile`.
* 
* @param { string } unit - The `unit` input parameter determines which unit of
* metadata to use for fetching the file data. It defaults to 'own' if not specified.
* 
* @param { any } metadata - The `metadata` input parameter provides optional metadata
* information about the files to be retrieved.
* 
* @param { string } actualUnit - The `actualUnit` input parameter passes the final
* unit (whether "own" or otherwise) of the metadata fetched by the inner promise
* within getFiles().
* 
* @returns { Promise }
*/
export const getFiles = async (
  unit: string,
  metadata?: any,
  actualUnit?: string,
): Promise<{ src: string; mediaType: string }[]> => {
  ensureInit();
  const files = [];
  let tokenMetadata = metadata;

  if (unit !== 'own') {
    tokenMetadata = await getMetadata(unit);
    actualUnit = unit;
  }

  for (let c = 0; c < tokenMetadata?.files.length; c++) {
    const tfile: {
      src?: string;
      mediaType?: string;
      id?: string | number;
      origSrc?: string;
      targetSrc?: string;
      unit?: string;
      props?: {};
    } = {
      src: tokenMetadata?.files[c].src,
      mediaType: tokenMetadata?.files[c].mediaType,
      id: tokenMetadata?.files[c]?.id,
    };
    const sresult = await getFile(unit, c, tokenMetadata);
    const blob = new Blob([sresult.buffer], { type: sresult.mediaType });
    const fileSrc = await getDataURLFromBlob(blob);
    const tobj: any = { ...tfile };
    tobj.origSrc = tobj.src;
    tobj.src = fileSrc;
    tobj.mediaType = blob.type;
    tobj.props = { ...tokenMetadata?.files[c] };
    delete tobj.props.src;
    delete tobj.props.mediaType;
    tobj.unit = actualUnit;
    if (sresult.props) Object.assign(tobj.props, sresult.props);
    if (sresult.unit && sresult.unit !== unit) {
      const ntfile: any = { ...tobj };
      ntfile.origId = tobj?.id;
      ntfile.id = sresult?.id;
      ntfile.src = tfile.src;
      ntfile.origSrc = tfile.origSrc;
      ntfile.targetSrc = sresult.src;
      ntfile.unit = sresult.unit;
      ntfile.origUnit = actualUnit;
      ntfile.mediaType = sresult.mediaType;
      ntfile.origMediaType = tfile.mediaType;
      files.push(ntfile);
    }
    files.push(tobj);
  }
  return files;
};
/**
* @description
* 
* @param { Blob } blob -
* 
* @returns {  }
*/
export const getURLEncodedDataURLFromBlob = async (blob: Blob) => {
  const ab = await blob.arrayBuffer();
  const ia = new Uint8Array(ab);
  const tresult = new TextDecoder().decode(ia);
  const mType = blob.type.split(';')[0];
  const fileSrc = 'data:' + mType + ',' + encodeURIComponent(tresult);
  return fileSrc;
};
/**
* @description
* 
* @param { Blob } blob -
* 
* @returns { Promise }
*/
export const getDataURLFromBlob = async (blob: Blob): Promise<string> => {
  const arrayBuf = await blob.arrayBuffer();
  const mType = blob.type.split(';')[0];
  return 'data:' + mType + ';base64,' + Buffer.from(arrayBuf).toString('base64'); // Currently not using the function above because I have no prob
};
/**
* @description
* 
* @param { string } unit -
* 
* @param {  } files -
* 
* @param { any } metadata -
* 
* @returns { Promise }
*/
export const getFilesFromArray = async (
  unit: string,
  files: ({ src?: string; mediaType?: string; id?: string | number } | string)[],
  metadata: any,
): Promise<any> => {
  const result: any = {};
  for (const file of files) {
    try {
      if (file === 'own') {
        result[unit] = await getFiles('own', metadata, unit);
      } else if (typeof file === 'string') {
        result[file] = await getFiles(file);
      } else if (file?.src) {
        const tfile: {
          src?: string;
          mediaType?: string;
          id?: string | number;
          origSrc?: string;
          targetSrc?: string;
          unit?: string;
          props?: any;
        } = { src: file.src, mediaType: file.mediaType, id: file.id };
        // const file = {}

        const sresult: { mediaType: any; buffer: any; unit?: string; id?: string | number; props?: any; src?: string } =
          await getFileFromSrc(tfile?.src || '', tfile?.mediaType || '');
        const blob = new Blob([sresult.buffer], { type: sresult.mediaType });
        tfile.origSrc = tfile.src;
        tfile.props = { ...file };
        tfile.unit = unit;
        if (sresult.props) Object.assign(tfile.props, sresult.props);
        delete tfile.props?.src;
        delete tfile.props?.mediaType;
        tfile.src = await getDataURLFromBlob(blob);
        if (!result[unit]) result[unit] = [];
        if (sresult.unit && sresult.unit !== unit) {
          if (!result[sresult.unit]) result[sresult.unit] = [];
          const ntfile: any = { ...tfile };
          ntfile.origId = tfile?.id;
          ntfile.id = sresult?.id;
          ntfile.props = { ...tfile.props };
          if (sresult?.props) Object.assign(ntfile.props, sresult.props);
          delete ntfile.props?.src;
          delete ntfile.props?.mediaType;
          ntfile.src = tfile.src;
          ntfile.origSrc = tfile.origSrc;
          ntfile.targetSrc = sresult.src;
          ntfile.unit = sresult.unit;
          ntfile.origUnit = unit;
          ntfile.mediaType = sresult.mediaType;
          ntfile.origMediaType = tfile.mediaType;
          result[sresult.unit].push(ntfile);
        }
        result[unit].push(tfile);
      }
    } catch (e) {
      if (!result.error) result.error = [];
      result.error.push('Error getting files:(' + unit + ' ' + file + '): ' + e);
    }
    if (result[unit]?.length > 5) break; // limit from downloading too many files, the front end api will always download them individually if it needs to
  }
  return result;
};
/**
* @description
* 
* @param { string } src -
* 
* @param { string } mediaType -
* 
* @returns { Promise }
*/
export const getFileFromSrc = async (
  src: string,
  mediaType: string,
): Promise<{ buffer: any; mediaType: string; id?: string | number; unit?: string; props?: any }> => {
  const result: { mediaType: string; buffer: any; unit?: string; id?: string | number; props?: any } = {
    mediaType,
    buffer: '',
  };
  if (!src) return null as any;

  if (src.substring(0, 5) === 'cnft:') {
    // Here we actually recurse
    const rresult = await getFile(src.substring(5).split('/', 2)[0], src.substring(5).split('/', 2)[1]);
    result.unit = src.substring(5).split('/', 2)[0];
    result.id = src.substring(5).split('/', 2)[1];
    result.buffer = rresult.buffer;
    result.props = rresult.props;
    result.mediaType = rresult.mediaType;
  } else if (src.substring(0, 14) === 'ipfs://ipfs://') {
    const res = await axios.get(IPFS_GATEWAY + src.substring(14), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (
    src.substring(0, 12) === 'ipfs://ipfs:' ||
    src.substring(0, 12) === 'ipfs:ipfs://' ||
    src.substring(0, 12) === 'ipfs://ipfs/'
  ) {
    const res = await axios.get(IPFS_GATEWAY + src.substring(12), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 7) === 'ipfs://') {
    const res = await axios.get(IPFS_GATEWAY + src.substring(7), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
    /*
  } else if (multihash.validate(Uint8Array.from(Buffer.from(src).alloc((46))))) {
    const res = await axios.get(IPFS_GATEWAY + src, { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;*/
  } else if (src.substring(0, 5) === 'ar://') {
    const res = await axios.get(ARWEAVE_GATEWAY + src.substring(5), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 5) === 'data:') {
    const [first, ...rest] = src.split(',');
    let lbuffer = null;
    if (first.includes('base64')) {
      lbuffer = Buffer.from(rest.join(','), 'base64');
    } else if (first.match(/utf8/i)) {
      if (rest.join(',').match(/(%[0-9]{2})/)) {
        try {
          lbuffer = decodeURIComponent(rest.join(','));
        } catch (e) {}
      }
      if (!lbuffer) lbuffer = rest.join(',');
    } else {
      lbuffer = decodeURIComponent(rest.join(','));
    }
    // Something not quite right with this bit
    result.buffer = lbuffer;
    if (!result.mediaType && src) {
      const res = src.match(/[^:]\w+\/[\w-+\d.]+(?=;|,)/);
      if (res && res.length) {
        result.mediaType = res[0];
      }
    }
  } else if (src.substring(0, 8) === 'https://') {
    const res = await axios.get(src, { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 7) === 'http://') {
    const res = await axios.get(src, { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 5) === 'ipfs/') {
    const res = await axios.get(IPFS_GATEWAY + src.substring(5), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 6) === '/ipfs/') {
    const res = await axios.get(IPFS_GATEWAY + src.substring(6), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.length === 46) {
    // ipfs hash is 46 bytes long, sometimes people get confused
    const res = await axios.get(IPFS_GATEWAY + src, { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  }
  return result;
};

/**
* @description
* 
* @param { string } unit -
* 
* @param {  } id -
* 
* @param {  } metadata -
* 
* @returns { Promise }
*/
export const getFile = async (
  unit: string,
  id: string | number | null,
  metadata: any | null = null,
): Promise<{ buffer: any; mediaType: string; props?: any; unit?: string; id?: string; src?: string }> => {
  ensureInit();
  let file = null;

  if (unit === 'own' && metadata) {
    if (!id) {
      try {
        file = { src: metadata?.image };
      } catch (e) {}
    }
    if (!file) {
      try {
/**
* @description
* 
* @param { any } f -
*/
        file = metadata.files.filter((f: any) => f.id === id)[0];
/**
* @description
* 
* @param { any } f -
*/
        if (!file) file = metadata?.uses?.files.filter((f: any) => f.id === id)[0];
      } catch (e) {}
      if (typeof id === 'number' || (id && !isNaN(parseInt(id, undefined)) && !file)) {
        try {
          file = metadata.files[parseInt(String(id), undefined)];
          if (!file) file = metadata.uses?.files[parseInt(String(id), undefined)];
        } catch (e) {}
      }
    }
  } else {
    const tokenMetadata = await getMetadata(unit);
    if (!id) {
      try {
        file = { src: tokenMetadata?.image };
      } catch (e) {}
    }
    if (!file) {
      try {
/**
* @description
* 
* @param { any } f -
*/
        file = tokenMetadata?.files.filter((f: any) => f.id === id)[0];
/**
* @description
* 
* @param { any } f -
*/
        if (!file) file = tokenMetadata?.uses?.files.filter((f: any) => f.id === id)[0];
      } catch (e) {}
      if (typeof id === 'number' || (id && !isNaN(parseInt(id, undefined)) && !file)) {
        try {
          file = tokenMetadata?.files[parseInt(String(id), undefined)];
          if (!file) file = tokenMetadata?.uses?.files[parseInt(String(id), undefined)];
        } catch (e) {}
      }
    }
  }
  if (!file) {
    throw new Error('File Not Found: -' + unit + ' ' + id + '-');
  }
  let src = file.src;
  if (Array.isArray(src)) {
    src = src.join('');
  }

  const result: { mediaType: any; buffer: any; props?: any; unit?: any; id?: any; src?: string } = await getFileFromSrc(
    src,
    file?.mediaType,
  );
  if (!result) return null as any;
  result.src = src;
  const origProps = result.props;
  result.props = { ...file };
  if (origProps) Object.assign(result.props, origProps);
  delete result?.props?.buffer;
  delete result?.props?.src;
  delete result?.props?.mediaType;
  if (!result.unit) result.unit = unit;
  if (!result.id) result.id = id;
  return result;
};
/**
* @description
* 
* @param { string } unit -
* 
* @param { number } [count=10] -
* 
* @param { number } page -
* 
* @returns { Promise }
*/
export const getAddresses = async (
  unit: string,
  count: number = 10,
  page?: number,
): Promise<{ address: string; quantity: number }[]> => {
  ensureInit();
  if (!_pgClient) return [];
  if (!page) page = 0;
  let cresult;
  if ((cresult = await checkCache('getAddresses:' + page + ':' + count + ':' + unit))) return cresult;

  let addresses = null;
  addresses = await _pgClient.query(
    `
  SELECT tx_out.address as "address", sum(quantity)::TEXT as "quantity"
      FROM multi_asset
          JOIN ma_tx_out      ON (ma_tx_out.ident = multi_asset.id)
          JOIN tx_out         ON (tx_out.id = ma_tx_out.tx_out_id)
          JOIN tx             ON (tx.id = tx_out.tx_id)
          JOIN utxo_view      ON (utxo_view.id = ma_tx_out.tx_out_id) 
      WHERE valid_contract = 'true'
          AND policy = decode(substr($1, 1, 56), 'hex') AND name = decode(substr($1, 57), 'hex')
      GROUP BY tx_out.address
      ORDER BY sum(quantity) DESC
      LIMIT $2
      OFFSET $3
  `,
    [unit, count, count * page],
  );
  // AND (encode(policy, 'hex') || encode(name, 'hex')) = $1::TEXT
  const ret: { address: string; quantity: number }[] = addresses.rows;
  await doCache('getAddresses:' + page + ':' + count + ':' + unit, ret);
  return ret;
  // Alternatively you can get this data from BF:
  // addresses = await Blockfrost.API.assetsAddresses(unit);
};
/**
* @description
* 
* @param {  } featureTree -
* 
* @param { any } metadata -
* 
* @param { string } walletAddr -
* 
* @param { string } tokenUnit -
* 
* @returns {  }
*/
export const getSmartImports = async (
  featureTree: {
    libraries: { name: string; version: string }[];
    tokens: string[] | string;
    utxos: string[] | string;
    transactions: string[] | string;
    mintTx?: boolean;
    files?: boolean | string | ({ src?: string; mediaType?: string } | string)[];
  },
  metadata: any,
  walletAddr: string,
  tokenUnit: string,
) => {
  const ret: any = {
    libraries: [],
    css: [],
    tokens: {},
    utxos: {},
    transactions: {},
    ownerAddr: walletAddr,
    fetchedAt: new Date(),
    tokenUnit,
    libcip54Version: '0',
  };
  ret.libcip54Version = pJSON.version;
  if (featureTree?.libraries?.length > 0) {
    const librariesResult = await getLibraries(featureTree);
    ret.libraries = librariesResult.libraries;
    ret.css = librariesResult.css;
  }
  if (featureTree?.tokens?.length > 0) {
    ret.tokens = await getTokens(featureTree, walletAddr);
  }
  if (featureTree?.utxos?.length > 0) {
    ret.utxos = await getUTXOs(featureTree, walletAddr);
  }
  if (featureTree?.transactions?.length > 0) {
    ret.transactions = await getTransactions(featureTree, walletAddr);
  }
  if (featureTree?.mintTx) {
    ret.mintTx = await getMintTx(tokenUnit);
  }
  if (featureTree?.files) {
    if (typeof featureTree?.files === 'boolean' || typeof featureTree?.files === 'number') {
      ret.files = featureTree?.files;
    } else {
      if (typeof featureTree?.files === 'string') {
        featureTree.files = [featureTree?.files];
      }
      ret.files = await getFilesFromArray(tokenUnit, featureTree?.files, metadata);
    }
  }
  return ret;
};

// Util functions

/**
* @description
* 
* @param { string } baseAddress -
* 
* @returns {  }
*/
export function getStake(baseAddress: string): string | null {
  const address = CSL.BaseAddress.from_address(CSL.Address.from_bech32(baseAddress));
  if (!address) return null;

  return CSL.RewardAddress.new(_networkId || 0, address.stake_cred())
    .to_address()
    .to_bech32()
    .toLowerCase();
}

/**
* @description
* 
* @param { string } address -
* 
* @returns {  }
*/
export function getStakeFromAny(address: string): string | null {
  // Todo - make this support address being a CSL address object
  const Address = validAddress(address);
  if (!Address) return null;
  if (CSL.BaseAddress.from_address(Address)) {
    return getStake(Address.to_bech32());
  } else if (CSL.RewardAddress.from_address(Address)) {
    return Address.to_bech32().toLowerCase();
  }
  return null;
}

/**
* @description
* 
* @param { string } payment -
* 
* @param { string } stake -
* 
* @returns {  }
*/
export function getBaseAddress(payment: string, stake: string) {
  ensureInit();
  return CSL.BaseAddress.new(
    _networkId || 0,
    CSL.StakeCredential.from_keyhash(CSL.Ed25519KeyHash.from_hex(payment)),
    CSL.StakeCredential.from_keyhash(CSL.Ed25519KeyHash.from_hex(stake)),
  )
    .to_address()
    .to_bech32();
}

/**
* @description
* 
* @param { string } address -
* 
* @returns {  }
*/
export function validAddress(address: string) {
  try {
    return CSL.Address.from_bech32(address);
  } catch (e) {}

  try {
    return CSL.Address.from_hex(address);
  } catch (e) {}

  return;
}

/**
* @description
* 
* @param { string } address -
* 
* @returns {  }
*/
export function validBech32Address(address: string) {
  try {
    return CSL.Address.from_bech32(address);
  } catch (e) {}
  return;
}

/**
* @description
* 
* @param { string } address -
* 
* @returns {  }
*/
export function addressType(address: string) {
  const Address = validAddress(address);
  if (!Address) return;

  if (CSL.BaseAddress.from_address(Address)) {
    return 'Base';
  } else if (CSL.EnterpriseAddress.from_address(Address)) {
    return 'Enterprise';
  } else if (CSL.RewardAddress.from_address(Address)) {
    return 'Stake';
  }

  return;
}

/**
* @description
* 
* @param { number } label -
* 
* @returns {  }
*/
export const labelIsCIP68 = (label: number) => {
  if (!label) return false;
  return label === REFERENCE_TOKEN_LABEL || label === USER_TOKEN_LABEL;
};

/**
 * @param name Hex encoded
 */
export function toUnit(policyId: string, name?: string | null, label?: number | null): string {
  const hexLabel = Number.isInteger(label) ? toLabel(label!) : '';
  const n = name ? name : '';
  if ((n + hexLabel).length > 64) {
    throw new Error('Asset name size exceeds 32 bytes.');
  }
  if (policyId.length !== 56) {
    throw new Error(`Policy id invalid: ${policyId}.`);
  }
  return policyId + hexLabel + n;
}

/**
 * Splits unit into policy id, asset name (entire asset name), name (asset name without label) and label if applicable.
 * name will be returned in Hex.
 */
export function fromUnit(unit: string): {
  policyId: string;
  assetName: string | null;
  name: string | null;
  label: number | null;
} {
  const policyId = unit.slice(0, 56);
  const assetName = unit.slice(56) || null;
  const label = fromLabel(unit.slice(56, 64));
/**
* @description
* 
* @returns {  }
*/
  const name = (() => {
    const hexName = Number.isInteger(label) ? unit.slice(64) : unit.slice(56);
    return hexName || null;
  })();
  return { policyId, assetName, name, label };
}
/**
* @description
* 
* @param { number } num -
* 
* @returns { string }
*/
export function toLabel(num: number): string {
  if (num < 0 || num > 65535) {
    throw new Error(`Label ${num} out of range: min label 1 - max label 65535.`);
  }
  const numHex = num.toString(16).padStart(4, '0');
  return '0' + numHex + checksum(numHex) + '0';
}

/**
* @description
* 
* @param { string } label -
* 
* @returns {  }
*/
export function fromLabel(label: string): number | null {
  if (label.length !== 8 || !(label[0] === '0' && label[7] === '0')) {
    return null;
  }
  const numHex = label.slice(1, 5);
  const num = parseInt(numHex, 16);
  const check = label.slice(5, 7);
  return check === checksum(numHex) ? num : null;
}

/** Padded number in Hex. */
/** Padded number in Hex. */
function checksum(num: string): string {
  return crc8(fromHex(num)).toString(16).padStart(2, '0');
}
/**
* @description
* 
* @param { string } hex -
* 
* @returns { Uint8Array }
*/
export function fromHex(hex: string): Uint8Array {
  return Buffer.from(hex, 'hex');
}
// This is a partial reimplementation of CRC-8 (node-crc) in Deno: https://github.com/alexgorbatchev/node-crc

let TABLE: number[] | Int32Array = [
  0x00, 0x07, 0x0e, 0x09, 0x1c, 0x1b, 0x12, 0x15, 0x38, 0x3f, 0x36, 0x31, 0x24, 0x23, 0x2a, 0x2d, 0x70, 0x77, 0x7e,
  0x79, 0x6c, 0x6b, 0x62, 0x65, 0x48, 0x4f, 0x46, 0x41, 0x54, 0x53, 0x5a, 0x5d, 0xe0, 0xe7, 0xee, 0xe9, 0xfc, 0xfb,
  0xf2, 0xf5, 0xd8, 0xdf, 0xd6, 0xd1, 0xc4, 0xc3, 0xca, 0xcd, 0x90, 0x97, 0x9e, 0x99, 0x8c, 0x8b, 0x82, 0x85, 0xa8,
  0xaf, 0xa6, 0xa1, 0xb4, 0xb3, 0xba, 0xbd, 0xc7, 0xc0, 0xc9, 0xce, 0xdb, 0xdc, 0xd5, 0xd2, 0xff, 0xf8, 0xf1, 0xf6,
  0xe3, 0xe4, 0xed, 0xea, 0xb7, 0xb0, 0xb9, 0xbe, 0xab, 0xac, 0xa5, 0xa2, 0x8f, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9d,
  0x9a, 0x27, 0x20, 0x29, 0x2e, 0x3b, 0x3c, 0x35, 0x32, 0x1f, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0d, 0x0a, 0x57, 0x50,
  0x59, 0x5e, 0x4b, 0x4c, 0x45, 0x42, 0x6f, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7d, 0x7a, 0x89, 0x8e, 0x87, 0x80, 0x95,
  0x92, 0x9b, 0x9c, 0xb1, 0xb6, 0xbf, 0xb8, 0xad, 0xaa, 0xa3, 0xa4, 0xf9, 0xfe, 0xf7, 0xf0, 0xe5, 0xe2, 0xeb, 0xec,
  0xc1, 0xc6, 0xcf, 0xc8, 0xdd, 0xda, 0xd3, 0xd4, 0x69, 0x6e, 0x67, 0x60, 0x75, 0x72, 0x7b, 0x7c, 0x51, 0x56, 0x5f,
  0x58, 0x4d, 0x4a, 0x43, 0x44, 0x19, 0x1e, 0x17, 0x10, 0x05, 0x02, 0x0b, 0x0c, 0x21, 0x26, 0x2f, 0x28, 0x3d, 0x3a,
  0x33, 0x34, 0x4e, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5c, 0x5b, 0x76, 0x71, 0x78, 0x7f, 0x6a, 0x6d, 0x64, 0x63, 0x3e,
  0x39, 0x30, 0x37, 0x22, 0x25, 0x2c, 0x2b, 0x06, 0x01, 0x08, 0x0f, 0x1a, 0x1d, 0x14, 0x13, 0xae, 0xa9, 0xa0, 0xa7,
  0xb2, 0xb5, 0xbc, 0xbb, 0x96, 0x91, 0x98, 0x9f, 0x8a, 0x8d, 0x84, 0x83, 0xde, 0xd9, 0xd0, 0xd7, 0xc2, 0xc5, 0xcc,
  0xcb, 0xe6, 0xe1, 0xe8, 0xef, 0xfa, 0xfd, 0xf4, 0xf3,
];

if (typeof Int32Array !== 'undefined') {
  TABLE = new Int32Array(TABLE);
}

/**
* @description
* 
* @param { Uint8Array } current -
* 
* @param {  } [previous=0] -
* 
* @returns { number }
*/
export function crc8(current: Uint8Array, previous = 0): number {
  let crc = ~~previous;

  for (let index = 0; index < current.length; index++) {
    crc = TABLE[(crc ^ current[index]) & 0xff] & 0xff;
  }

  return crc;
}

/**
* @description
* 
* @param { string } str -
* 
* @returns {  }
*/
export const base64ToUnicode = (str: string) => {
  return decodeURIComponent(
/**
* @description
* 
* @param {  } c -
* 
* @returns {  }
*/
    atob(str)
      .split('')
      .map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(''),
  );
};
/**
* @description
* 
* @param { string } str1 -
* 
* @returns {  }
*/
export function hexToAscii(str1: string) {
  const hex = str1.toString();
  let str = '';
  for (let n = 0; n < hex.length; n += 2) {
    str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
  }
  return str;
}
/**
* @description
* 
* @param { string } str -
* 
* @returns {  }
*/
export function unicodeToBase64(str: string) {
  return btoa(
/**
* @description
* 
* @param {  } match -
* 
* @param {  } p1 -
* 
* @returns {  }
*/
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function toSolidBytes(match, p1) {
      return String.fromCharCode(Number('0x' + p1));
    }),
  );
}
/**
* @description
* 
* @param { string } dataURI -
* 
* @returns {  }
*/
export const dataURItoString = (dataURI: string) => {
  let byteString = '';
  const [first, ...rest] = dataURI.split(',');
  if (first.includes('base64')) {
    byteString = base64ToUnicode(rest.join(','));
  } else if (first.match(/utf8/i)) {
    if (rest.join(',').match(/(%[0-9]{2})/)) {
      try {
        byteString = decodeURIComponent(rest.join(','));
        return byteString;
      } catch (e) {}
    }
    byteString = rest.join(',');
  } else {
    byteString = decodeURIComponent(rest.join(','));
  }
  // let mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0] // Not needed but extracted anyway
  return byteString;
};
/**
* @description
* 
* @param { string } str -
* 
* @returns {  }
*/
export function asciiToHex(str: string) {
  const arr1 = [];
  for (let n = 0, l = str.length; n < l; n++) {
    const hex = Number(str.charCodeAt(n)).toString(16);
    arr1.push(hex);
  }
  return arr1.join('');
}

