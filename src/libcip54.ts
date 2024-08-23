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
let _getTimeout: number = 2000;
import pJSON from '../package.json';
import multihash from 'multihashes';

/**
 * @description Initializes various parameters and sets up connections for a application.
 * It takes several arguments, including network ID, PostgreSQL client, IPFS gateway,
 * Arweave gateway, Redis client, and other settings. The function assigns these
 * values to corresponding properties, setting up the application's environment.
 *
 * @param {'mainnet' | 'testnet'} networkId - Used to determine the network environment.
 *
 * @param {pgCon.Client} connection - Used to establish a PostgreSQL connection.
 *
 * @param {string | null} ipfsGateway - Used for IPFS gateway configuration.
 *
 * @param {string | null} arweaveGateway - Used to set an Arweave gateway.
 *
 * @param {RedisClientType | null} redis - Used to connect to Redis.
 *
 * @param {string} redisPrefix - Used to prefix keys in Redis.
 *
 * @param {number} redisTTL - Used to set the time-to-live for data stored in Redis.
 *
 * @param {number} getTimeout - Used to set the timeout for getting data.
 */
export const init = (
  networkId: 'mainnet' | 'testnet',
  connection: pgCon.Client,
  ipfsGateway: string | null = null,
  arweaveGateway: string | null = null,
  redis: RedisClientType | null = null,
  redisPrefix: string = 'cip54:',
  redisTTL: number = 3600,
  getTimeout: number = 2000
) => {
  _networkId = networkId === 'testnet' ? 0 : 1;
  _pgClient = connection;
  IPFS_GATEWAY = ipfsGateway;
  ARWEAVE_GATEWAY = arweaveGateway;
  _redis = redis;
  _redisPrefix = redisPrefix;
  _redisTTL = redisTTL;
  _getTimeout = getTimeout;
};

/**
 * @description Checks whether `_pgClient` and `_networkId` are initialized. If not,
 * it throws an error with a specific message indicating that the library must be
 * initialized before use.
 */
const ensureInit = () => {
  if (!_pgClient || !_networkId) throw new Error('Libcip54 error - please initialize before use');
};

/**
 * @description Retrieves a predefined timeout value `_getTimeout` and returns it as
 * a number, exporting the result.
 *
 * @returns {number} `_getTimeout`.
 */
export const queryGetTimeout = ():number => { 
  return _getTimeout;
}

/**
 * @description Sets a global variable `_getTimeout` to a specified time interval
 * (default is 2000ms). The function takes an optional argument `ms`, which overrides
 * the default timeout value, and assigns it to the `_getTimeout` variable for
 * subsequent use.
 *
 * @param {number} ms - Intended to represent time interval.
 */
export const setGetTimeout = (ms: number = 2000) => { 
  _getTimeout = ms;
}

/**
 * @description Retrieves a value from Redis cache based on the provided `name`. If
 * no cache is found or Redis connection is not established, it returns null. Otherwise,
 * it parses the cached JSON data and returns it.
 *
 * @param {string} name - Used to identify cached data.
 *
 * @returns {object} Parsed from a JSON string retrieved from Redis storage. If no
 * cache exists for the given name or Redis connection fails, it returns null.
 */
const checkCache = async (name: string) => {
  if (!_redis) return null;
  let cache: any = await _redis.get(_redisPrefix + ':' + name);
  if (!cache) return null;
  cache = JSON.parse(cache);
  return cache;
};

/**
 * @description Asynchronously caches data with a specified time-to-live (TTL) using
 * Redis. It sets a key-value pair in Redis with the provided name and data, serialized
 * to JSON, and expires after the specified TTL or uses a default TTL if none is provided.
 *
 * @param {string} name - Used to identify the cache entry.
 *
 * @param {any} data - Expected to hold cache data as JSON string.
 */
const doCache = async (name: string, data: any, ttl?: number) => {
  if (!_redis) return;
  await _redis.setEx(_redisPrefix + ':' + name, ttl ? ttl : _redisTTL, JSON.stringify(data));
};

/**
 * @description Retrieves JSON data from a given URL. If Redis is available, it first
 * checks if the cache contains the requested data; if so, it returns the cached
 * result. Otherwise, it fetches and caches the data for future use.
 *
 * @param {string} url - Required to fetch JSON data from an API endpoint.
 *
 * @returns {object} Parsed JSON from the URL provided as an argument if it is fetched
 * directly; otherwise, a cached result.
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
 * @description Asynchronously fetches a blob from a given URL. It first checks if
 * Redis cache is available. If not, it directly fetches the blob and returns it. If
 * Redis is available, it attempts to retrieve the cached blob. If found, it returns
 * the cached blob; otherwise, it fetches, caches, and returns the blob.
 *
 * @param {string} url - Required for fetching a blob from the specified URL.
 *
 * @returns {Blob} A binary data object that contains the data of the requested URL.
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
 * @description Retrieves a collection of transactions based on a feature tree and
 * wallet address. It iterates over the transaction list, resolves stake addresses,
 * fetches transactions from each stake, and aggregates them into an object for return.
 *
 * @param {{ transactions: string[] | string }} featureTree - Used to hold the list
 * of transactions.
 *
 * @param {string} walletAddr - Used to represent the wallet address.
 *
 * @returns {Promise<object>} An object that contains a set of transactions retrieved
 * from different stakes, where each key in the object represents a stake address and
 * its corresponding value is an array of transactions associated with that stake.
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
 * @description Retrieves a list of transactions from a specified stake address,
 * filtered by valid contracts and stake view. It fetches data from the PostgreSQL
 * database, aggregates it, caches results for future use, and returns up to 20
 * transactions per page.
 *
 * @param {string} stakeAddress - Used to filter transactions by stake address.
 *
 * @param {number} page - Used to specify the page number for pagination.
 *
 * @returns {Promise<any>} An array of objects containing various transaction data,
 * including hash, out_sum, fee, deposit, size, invalid_before, and more. Each object
 * represents a single transaction.
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
 * @description Retrieves and processes a unique identifier (handle) associated with
 * a given wallet address from a PostgreSQL database, ensuring cache validity and
 * handling potential errors.
 *
 * @param {string} walletAddr - The wallet address to retrieve Ada handle for.
 *
 * @returns {Promise<object | null>} Either an object representing a handle if found,
 * or null if not found.
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
 * @description Retrieves tokens associated with a wallet address or stake addresses,
 * based on input data from a feature tree. It iterates over the token list, extracts
 * stake addresses, and calls another function to obtain tokens from each stake
 * address, returning the results as an object.
 *
 * @param {{ tokens: string[] | string }} featureTree - Required for token retrieval.
 *
 * @param {string} walletAddr - Used to replace 'own' stake addresses with wallet addresses.
 *
 * @returns {Promise<object>} An object that contains key-value pairs where keys are
 * stake addresses and values are arrays of tokens associated with those stakes.
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
 * @description Retrieves tokens from a given address. It first tries to find a stake
 * address using the `getStakeFromAny` function and then calls `getTokensFromStake`
 * with the obtained stake address and page number, returning an array of tokens or
 * null if no stake is found.
 *
 * @param {string} address - Required for processing tokens from any address.
 *
 * @param {number} page - Used to specify a page number for pagination.
 *
 * @returns {Promise<{ unit: string; quantity: number }[] | null>} Either an array
 * of objects with properties 'unit' and 'quantity', or null if no tokens are found.
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
 * @description Retrieves tokens staked at a given address from a PostgreSQL database.
 * It returns an array of objects containing the token unit and quantity. The function
 * also caches its results for efficiency.
 *
 * @param {string} stakeAddress - Used to identify a specific stake address for token
 * retrieval.
 *
 * @param {number} page - Used to specify the page number for pagination.
 *
 * @param {boolean} policies - Used to filter or group the token data based on policies.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing a unit and a quantity.
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
 * @description Retrieves a list of unique policies associated with a specified stake
 * address from the blockchain, returning an array of objects containing 'unit' and
 * 'quantity'. It utilizes another asynchronous function `getTokensFromStake` to fetch
 * the data.
 *
 * @param {string} stakeAddress - Required.
 *
 * @param {number} page - Used to specify pagination.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing 'unit' and 'quantity'.
 */
export async function getUniquePoliciesFromStake(
  stakeAddress: string,
  page: number = 0,
): Promise<{ unit: string; quantity: number }[]> {
  return await getTokensFromStake(stakeAddress, page, true);
}

/**
 * @description Retrieves a list of tokens from the PostgreSQL database based on a
 * given policy ID and optional page number. It also checks for cached results, updates
 * the cache if necessary, and returns the result set.
 *
 * @param {string} policyId - Used to filter tokens by policy.
 *
 * @param {number} page - Used to paginate the result set.
 *
 * @returns {Promise<any>} A list of objects containing two properties: 'unit' and
 * 'quantity', representing tokens from a specified policy, ordered by their total
 * quantity in descending order.
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
 * @description Retrieves policy holders for a given policy ID(s), with optional
 * pagination. It queries a PostgreSQL database, caches results to improve performance,
 * and returns an array of objects containing the sum of quantity and stake address
 * for each holder.
 *
 * @param {string | string[]} policyId - Used to filter policy holders.
 *
 * @param {number} page - Used to specify the page number for pagination.
 *
 * @returns {Promise<any>} An array of objects representing policy holders, containing
 * fields 'quantity' and 'stake'.
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
 * @description Retrieves a list of token holders for a given unit, including their
 * stake and total quantity of tokens held. It utilizes a Postgres database to fetch
 * data from multiple tables, caching results to optimize performance.
 *
 * @param {string} unit - Used to filter token holders.
 *
 * @param {number} page - Used to specify the page of results to be retrieved.
 *
 * @returns {Promise<any>} An array of objects containing information about token
 * holders, including their addresses, staked values, and total quantities.
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
 * @description Retrieves a collection of Unspent Transaction Outputs (UTXOs) associated
 * with a wallet address. It accepts a feature tree object and a wallet address, then
 * iterates through the UTXO array, fetching UTXOs from each stake address, and returns
 * them in an object.
 *
 * @param {{ utxos: string[] | string }} featureTree - An object containing UTXO data.
 *
 * @param {string} walletAddr - Used as the stake address when `utxos` contains 'own'.
 *
 * @returns {Promise<any>} An object where each key corresponds to a stake address
 * and its corresponding value is an array of utxos associated with that stake address.
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
 * @description Retrieves Unspent Transaction Outputs (UTXOs) associated with a
 * specified stake address from a database using a client object. It returns an array
 * of objects containing UTXO details, including transaction hash, index, and value,
 * along with optional multiasset information and datum data.
 *
 * @param {string} stakeAddress - Required for obtaining UTXOs from a stake address.
 *
 * @param {number} page - Used to specify a page number for pagination.
 *
 * @returns {Promise<
 *   {
 *     txHash: string;
 *     index: number;
 *     address: string;
 *     value: number;
 *     multiasset: { quantity: number; unit: string }[];
 *     datum: any | null;
 *   }[]
 * >} An array of objects containing UTXO data.
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
 * @description Retrieves unspent transaction outputs (UTXOs) from a given base
 * address, paginated by optional `page` parameter. It returns an array of objects
 * containing UTXO details. If the database connection is not established, it returns
 * an empty array.
 *
 * @param {string} baseAddress - Used as an input for retrieving UTXOs.
 *
 * @param {number} page - Used to specify pagination for retrieving UTXOs.
 *
 * @returns {Promise<
 *   {
 *     txHash: string;
 *     index: number;
 *     address: string;
 *     value: number;
 *     multiasset: { quantity: number; unit: string }[];
 *     datum: any | null;
 *   }[]
 * >} An array of objects containing data about UTXOs (Unspent Transaction Outputs)
 * that match the provided base address.
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
 * @description Retrieves a list of unspent transaction outputs (UTXOs) from either
 * a stake address or a base address, depending on input parameters. It caches results
 * and returns a promise with an array of UTXO objects containing details such as
 * txHash, index, value, and more.
 *
 * @param {string | null} stakeAddress - Used to filter UTXOs by stake address.
 *
 * @param {string | null} baseAddress - Optional.
 *
 * @param {number} page - Used for pagination purposes.
 *
 * @returns {Promise<
 *   {
 *     txHash: string;
 *     index: number;
 *     address: string;
 *     value: number;
 *     multiasset: { quantity: number; unit: string }[];
 *     datum: any | null;
 *   }[]
 * >} An array of objects containing information about UTXOs.
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
 * @description Retrieves libraries and their associated CSS files from a CDN, filters
 * out unwanted files, converts binary responses to text, and returns an object
 * containing arrays of JavaScript and CSS library sources.
 *
 * @param {{
 *   libraries: { name: string; version: string }[];
 * }} featureTree - Used to specify a tree-like structure containing library metadata.
 *
 * @returns {Promise<{ libraries: string[]; css: string[] }>} An object containing
 * two properties: `libraries` and `css`, both being arrays of strings representing
 * URLs of JavaScript and CSS files respectively.
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
 * @description Retrieves metadata for a given unit, which is a string representing
 * an NFT or token. It checks if the label conforms to CIP-68 and fetches data from
 * either mint transactions or CIP-68 metadata sources based on the label's format.
 *
 * @param {string} unit - Required for retrieving metadata.
 *
 * @returns {Promise<any>} Null when no valid metadata can be retrieved, otherwise
 * it returns a JSON object containing NFT metadata if the NFT has CIP-68 policy, or
 * the metadata from a specific CIP-68 label if the NFT has a CIP-68 label.
 */
export const getMetadata = async (unit: string): Promise<any> => {
  if (!unit || unit.length < 1) return null;
  const { label, name, policyId, assetName } = fromUnit(unit);
  let metadata = null;
  if (!label || !labelIsCIP68(label)) {
    const mintTx = await getMintTx(unit);
    if (mintTx && mintTx.metadata && typeof mintTx.metadata === 'object') {
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
 * @description Retrieves the metadata and transaction hash for a given unit from a
 * PostgreSQL database, caching the result to avoid subsequent database queries if
 * the same unit is requested again.
 *
 * @param {string} unit - 112 characters long.
 *
 * @returns {Promise<{ txHash: string; metadata: { key: string; json: object }[] } |
 * null>} Either an object with a txHash and an array of metadata objects or null.
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
 * @description Retrieves metadata for a given unit from a PostgreSQL database using
 * a SQL query, parses CBOR-encoded JSON data, and caches the result for future use.
 * It returns the parsed metadata if successful or null if no data is found.
 *
 * @param {string} unit - 64 characters long, representing a contract unit.
 *
 * @returns {Promise<any>} Either an object containing metadata, null if the query
 * did not find any data, false in case of a catch block error.
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
     * @description Recursively parses a CBOR (Concise Binary Object Representation) list
     * into a JSON array. It handles nested lists, maps, and bytes, converting them to
     * corresponding JSON structures. The input is expected to be an array of objects
     * with properties map, bytes, or list.
     *
     * @param {any} list - Expected to be an array.
     *
     * @returns {any} An array. The array contains elements that are either JSON objects,
     * strings, or arrays themselves.
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
     * @description Converts a CBOR (Concise Binary Object Representation) map into a
     * JavaScript object (JSON). It recursively traverses the CBOR data, extracting values
     * and converting them to JSON-compatible types (string, array, or another object),
     * then stores them in a new object with keys derived from the original CBOR map's
     * key bytes.
     *
     * @param {any} map - Expected to be an object containing CBOR data.
     *
     * @returns {any} An object containing key-value pairs where keys are strings and
     * values can be strings, arrays or objects.
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
 * @description Retrieves a list of file metadata and sources from the server, processes
 * the data, and returns an array of objects containing file source URLs, media types,
 * and additional properties.
 *
 * @param {string} unit - Required for processing files.
 *
 * @returns {Promise<{ src: string; mediaType: string }[]>} An array of objects
 * containing source strings and media types for files.
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
 * @description Converts a given blob into a URL-encoded data URL, which can be used
 * to display the blob's contents as an image or other media type. It extracts the
 * MIME type from the blob and combines it with the encoded buffer data to form the
 * data URL.
 *
 * @param {Blob} blob - Expected as input to generate URL-encoded data from.
 *
 * @returns {string} A URL-encoded data URI representing the input blob as a
 * base64-encoded binary data.
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
 * @description Converts a Blob object into a data URL. It achieves this by first
 * converting the Blob to an ArrayBuffer, then extracting the MIME type from the
 * Blob's type attribute. The ArrayBuffer is then converted to a base64-encoded string
 * and prepended with the appropriate 'data:' scheme.
 *
 * @param {Blob} blob - Expected to hold binary data.
 *
 * @returns {Promise<string>} A data URL that represents the given blob as a base64
 * encoded string prefixed with 'data:', followed by the MIME type and ';base64,'.
 */
export const getDataURLFromBlob = async (blob: Blob): Promise<string> => {
  const arrayBuf = await blob.arrayBuffer();
  const mType = blob.type.split(';')[0];
  return 'data:' + mType + ';base64,' + Buffer.from(arrayBuf).toString('base64'); // Currently not using the function above because I have no prob
};
/**
 * @description Retrieves an array of files based on input parameters such as a unit,
 * files, and metadata. It recursively fetches files from various sources, handles
 * file types, and returns a promise with the retrieved files grouped by unit and any
 * encountered errors.
 *
 * @param {string} unit - Used to group files together.
 *
 * @param {({ src?: string; mediaType?: string; id?: string | number } | string)[]}
 * files - An array of file objects or strings representing files to retrieve.
 *
 * @param {any} metadata - Used to store metadata for the files being retrieved.
 *
 * @returns {Promise<any>} An object (result) that contains arrays of files for each
 * unit, and possibly error messages in case of any errors during file retrieval.
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
 * @description Retrieves a file from various sources such as IPFS, ARWEAVE, and HTTP
 * URLs, converts it to a buffer, determines the media type if not provided, and
 * returns the result as a promise with an object containing the buffer, media type,
 * id, unit, and props.
 *
 * @param {string} src - The source URL to fetch a file from.
 *
 * @param {string} mediaType - Used to specify the expected media type of the file.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; id?: string | number; unit?:
 * string; props?: any }>} An object with properties buffer (any), mediaType (string),
 * and optionally id, unit, and props.
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
 * @description Retrieves a file by its ID and metadata for a specified unit, such
 * as "own" or token metadata. It attempts to find the file through various methods,
 * including filtering arrays and converting IDs to integers. If not found, it throws
 * an error.
 *
 * @param {string} unit - Optional.
 *
 * @param {string | number | null} id - Used to identify the file.
 *
 * @param {any | null} metadata - Optional.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; props?: any; unit?: string;
 * id?: string; src?: string }>} An object containing a file's buffer, media type,
 * optional properties, and source information.
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
        file = metadata.files.filter((f: any) => f.id === id)[0];
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
        file = tokenMetadata?.files.filter((f: any) => f.id === id)[0];
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
 * @description Retrieves a list of unique addresses associated with a specific unit,
 * along with their corresponding quantities. It checks for cached results first and
 * fetches data from PostgreSQL if necessary. The result is sorted by quantity in
 * descending order and paginated.
 *
 * @param {string} unit - Used to identify an asset or token.
 *
 * @param {number} count - Used to specify the number of addresses to return.
 *
 * @returns {Promise<{ address: string; quantity: number }[]>} An array of objects
 * containing a "address" property and a "quantity" property.
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
 * @description Retrieves and aggregates various data from a feature tree, including
 * libraries, tokens, UTXOs, transactions, and files, based on provided metadata and
 * wallet address. It returns a structured object containing the aggregated data.
 *
 * @param {{
 *     libraries: { name: string; version: string }[];
 *     tokens: string[] | string;
 *     utxos: string[] | string;
 *     transactions: string[] | string;
 *     mintTx?: boolean;
 *     files?: boolean | string | ({ src?: string; mediaType?: string } | string)[];
 *   }} featureTree - Used to fetch various features or data.
 *
 * @param {any} metadata - Unused in the code provided.
 *
 * @param {string} walletAddr - Intended to hold a wallet address.
 *
 * @param {string} tokenUnit - Used to specify the unit of the token.
 *
 * @returns {object} A structured data set containing various information such as
 * libraries, tokens, utxos, transactions, and files. This object also includes
 * metadata like timestamp, owner address, token unit, and version.
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
 * @description Takes a base address as input and returns the corresponding stake
 * address in lowercase bech32 format, or null if the provided base address is invalid.
 * It uses the CSL library to parse the base address and create a new reward address.
 *
 * @param {string} baseAddress - Necessary for the function's operation.
 *
 * @returns {string | null} Either a lower-case Bech32-encoded string representing a
 * stake address or null if no valid base address was provided.
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
 * @description Retrieves a stake value from an address and returns it as a string
 * or null if the address is invalid, CSL BaseAddress, or RewardAddress. It calls
 * helper functions to parse the address, check its type, and convert it to Bech32
 * format for retrieval of the stake.
 *
 * @param {string} address - Required to retrieve stake information.
 *
 * @returns {string | null} Either a lowercase string representing a reward address
 * or null if the input cannot be converted to a valid stake.
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
 * @description Generates a base address for a stake by creating a new `CSL.BaseAddress`
 * instance using the network ID, payment keyhash, and stake keyhash. It then converts
 * the address to bech32 format and returns it.
 *
 * @param {string} payment - Used to create a stake credential.
 *
 * @param {string} stake - Used to create stake credentials.
 *
 * @returns {string} A Bech32-encoded base address derived from the input network ID
 * and stake credentials.
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
 * @description Takes a string as input, attempts to convert it into a valid
 * cryptocurrency address using two methods: Bech32 and hexadecimal, and returns the
 * converted address if successful; otherwise, it does not return any value.
 *
 * @param {string} address - An input to be validated.
 *
 * @returns {CSL.Address | undefined} Either a successfully parsed address object
 * from Bech32 or hex format or undefined if parsing fails for both formats.
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
 * @description Attempts to convert a given address from Bech32 format into a valid
 * CSW Address using the `CSL.Address.from_bech32` method. If successful, it returns
 * the converted address; otherwise, it catches and ignores any exceptions, returning
 * undefined.
 *
 * @param {string} address - Expected to be a Bech32 encoded address.
 *
 * @returns {boolean | undefined} True if a valid Bech32 address is provided and false
 * otherwise, or it returns undefined if an error occurs while processing the input
 * string.
 */
export function validBech32Address(address: string) {
  try {
    return CSL.Address.from_bech32(address);
  } catch (e) {}
  return;
}

/**
 * @description Determines the type of a given cryptocurrency address based on its
 * validity and matches it with a specific class from the CSL namespace. It returns
 * 'Base', 'Enterprise', or 'Stake' accordingly, or returns without a value if the
 * address is invalid.
 *
 * @param {string} address - Input address to be validated.
 *
 * @returns {string} Either 'Base', 'Enterprise' or 'Stake'. If the input address
 * does not match any of these types, the function returns nothing (void).
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
 * @description Checks whether a given `label` is equal to either `REFERENCE_TOKEN_LABEL`
 * or `USER_TOKEN_LABEL`. If the `label` is not provided, it returns `false`. Otherwise,
 * it returns a boolean indicating whether the `label` matches one of the expected values.
 *
 * @param {number} label - Expected to represent a label value.
 *
 * @returns {boolean} True if the label matches either `REFERENCE_TOKEN_LABEL` or
 * `USER_TOKEN_LABEL`, and false otherwise.
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
  const name = (() => {
    const hexName = Number.isInteger(label) ? unit.slice(64) : unit.slice(56);
    return hexName || null;
  })();
  return { policyId, assetName, name, label };
}
/**
 * @description Converts a given number into a hexadecimal string representing a
 * label, ensuring it falls within the range of 1 to 65535. It also calculates and
 * appends a checksum for the label before returning the final result.
 *
 * @param {number} num - 16-bit integer value.
 *
 * @returns {string} 7 characters long and contains a formatted hexadecimal representation
 * of the input number, followed by a checksum of that number, prefixed with '0'.
 */
export function toLabel(num: number): string {
  if (num < 0 || num > 65535) {
    throw new Error(`Label ${num} out of range: min label 1 - max label 65535.`);
  }
  const numHex = num.toString(16).padStart(4, '0');
  return '0' + numHex + checksum(numHex) + '0';
}

/**
 * @description Converts a hexadecimal string into a numeric value if it meets certain
 * conditions: its length is exactly 8, and the first and last characters are '0'.
 * It calculates a checksum based on the first four characters and checks if it matches
 * the provided value.
 *
 * @param {string} label - 8 characters long.
 *
 * @returns {number | null} 0 or a null value. The returned value will be a hexadecimal
 * number if the provided label is valid and matches a specific pattern, otherwise
 * it will be null.
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
 * @description Converts a hexadecimal-encoded string to a binary data array (Uint8Array)
 * using Node.js' built-in `Buffer` class with the 'hex' encoding.
 *
 * @param {string} hex - Expected to be a hexadecimal string.
 *
 * @returns {Uint8Array} A buffer object holding an array of bytes, where each element
 * of the array corresponds to eight bits in a binary number.
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
 * @description Calculates the eight-bit cyclic redundancy check (CRC) value for a
 * given byte array `current`. It uses a pre-defined lookup table `TABLE` and an
 * initial value `previous`, updating the CRC with each byte in the array before
 * returning the result.
 *
 * @param {Uint8Array} current - Used as input for CRC calculation.
 *
 * @param {number} previous - Used to initialize the CRC calculation.
 *
 * @returns {number} 8-bit cyclic redundancy check (CRC) of the input data.
 */
export function crc8(current: Uint8Array, previous = 0): number {
  let crc = ~~previous;

  for (let index = 0; index < current.length; index++) {
    crc = TABLE[(crc ^ current[index]) & 0xff] & 0xff;
  }

  return crc;
}

/**
 * @description Converts a base64-encoded string to a Unicode-encoded string, which
 * is suitable for use in URLs or as query parameters. It uses the `atob` function
 * to decode the base64 string, then maps each character code to its corresponding
 * Unicode-encoded format.
 *
 * @param {string} str - 64-bit encoded base string.
 *
 * @returns {string} The Unicode equivalent of the input base64-encoded string.
 */
export const base64ToUnicode = (str: string) => {
  return decodeURIComponent(
    atob(str)
      .split('')
      .map((c) => {
        // Converts a character to hexadecimal URL encoding.

        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(''),
  );
};
/**
 * @description Converts a hexadecimal string to an ASCII string by parsing each pair
 * of hexadecimal characters as a decimal number and using it to retrieve the
 * corresponding ASCII character, which is then added to the resulting string.
 *
 * @param {string} str1 - Expected to contain hexadecimal data.
 *
 * @returns {string} The ASCII representation of a hexadecimal-encoded string.
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
 * @description Converts a given string from Unicode to Base64 format. It first encodes
 * the input string using URI components, then replaces each byte sequence with its
 * corresponding Unicode character representation, and finally applies Base64 encoding
 * on the resulting string.
 *
 * @param {string} str - Input to be converted.
 *
 * @returns {string} A Base64-encoded representation of a Unicode character sequence.
 */
export function unicodeToBase64(str: string) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function toSolidBytes(match, p1) {
      // Converts hexadecimal byte values back to ASCII characters.

      return String.fromCharCode(Number('0x' + p1));
    }),
  );
}
/**
 * @description Converts a given base64-encoded or UTF-8 encoded data URI into a plain
 * string, handling both cases by checking the first part of the data URI for specific
 * patterns and applying corresponding decoding methods.
 *
 * @param {string} dataURI - Data URL string that contains binary data.
 *
 * @returns {string} The decoded representation of a data URI.
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
 * @description Converts a given string into its ASCII hexadecimal representation by
 * iterating over each character, converting it to its Unicode code point using
 * `charCodeAt`, and then formatting the result as a hexadecimal string.
 *
 * @param {string} str - Input to convert into hexadecimal.
 *
 * @returns {string} A concatenation of hexadecimal representations of ASCII characters
 * in the input string.
 */
export function asciiToHex(str: string) {
  const arr1 = [];
  for (let n = 0, l = str.length; n < l; n++) {
    const hex = Number(str.charCodeAt(n)).toString(16);
    arr1.push(hex);
  }
  return arr1.join('');
}

