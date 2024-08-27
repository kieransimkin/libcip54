import pgCon from 'pg';
import axios from 'axios';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import punycode from 'punycode';
import { RedisClientType } from 'redis';
// Some contributions I will make back to harmoniclabs:
// cardano-ledger-ts has loads of unlisted dependencies.
import { byte, isBech32 } from '@harmoniclabs/crypto';
import {
  Address,
  Credential,
  Hash28,
  StakeAddress,
  StakeCredentials,
  CredentialType,
} from '@harmoniclabs/cardano-ledger-ts';
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
let _getTimeout: number = 120000;
import pJSON from '../package.json';

/**
 * @description Initializes variables with provided values and assigns default values
 * if not provided, setting up a connection to PostgreSQL, IPFS, Arweave, Redis
 * databases and defines constants for network ID, timeouts, and prefixes.
 *
 * @param {'mainnet' | 'testnet'} networkId - Used to determine which network
 * configuration to apply.
 *
 * @param {pgCon.Client} connection - Intended for establishing a PostgreSQL connection.
 *
 * @param {string | null} ipfsGateway - Used for IPFS gateway.
 *
 * @param {string | null} arweaveGateway - Intended to store an Arweave gateway URL.
 *
 * @param {RedisClientType | null} redis - Used for connection to Redis.
 *
 * @param {string} redisPrefix - Used to prefix Redis keys.
 *
 * @param {number} redisTTL - Used to set the time-to-live for stored data in Redis.
 *
 * @param {number} getTimeout - Used to set the timeout for API calls.
 */
export const init = (
  networkId: 'mainnet' | 'testnet',
  connection: pgCon.Client,
  ipfsGateway: string | null = null,
  arweaveGateway: string | null = null,
  redis: RedisClientType | null = null,
  redisPrefix: string = 'cip54:',
  redisTTL: number = 3600,
  getTimeout: number = 120000,
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
 * @description Performs an asynchronous GET request to the specified URL using Axios
 * library, with optional configuration and a timeout set by `_getTimeout`. The signal
 * is also set to timeout after `_getTimeout` seconds if no response is received.
 *
 * @param {string} url - The endpoint URL to be requested.
 *
 * @returns {Promise<AxiosResponse>} A promise that resolves to an AxiosResponse object.
 */
const axiosGet = async (url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> => {
  return await axios.get(url, { ...config, timeout: _getTimeout, signal: AbortSignal.timeout(_getTimeout) });
};

/**
 * @description Checks whether `_pgClient` and `_networkId` variables are initialized.
 * If not, it throws an error with a specific message indicating that initialization
 * is required before using the library.
 */
const ensureInit = () => {
  if (!_pgClient || !_networkId) throw new Error('Libcip54 error - please initialize before use');
};

/**
 * @description Exports a constant value `_getTimeout` as a number, which represents
 * the timeout for querying data. It simply returns the pre-defined `_getTimeout`
 * without any modification or computation.
 *
 * @returns {number} `_getTimeout`.
 */
export const queryGetTimeout = (): number => {
  return _getTimeout;
};

/**
 * @description Sets a timeout value, `_getTimeout`, to a specified number of
 * milliseconds (`ms`). If no value is provided, it defaults to 2000 (2 seconds).
 * This value can be accessed elsewhere in the code.
 *
 * @param {number} ms - Intended to set a timeout value.
 */
export const setGetTimeout = (ms: number = 2000) => {
  _getTimeout = ms;
};

/**
 * @description Retrieves a cached value from Redis for a given name, parsing it as
 * JSON if present, and returns `null` if no cache exists or if Redis is not initialized.
 *
 * @param {string} name - Used to retrieve data from Redis cache.
 *
 * @returns {object} Parsed from a JSON string retrieved from Redis if it exists;
 * otherwise, it returns null.
 */
const checkCache = async (name: string) => {
  if (!_redis) return null;
  let cache: any = await _redis.get(_redisPrefix + ':' + name);
  if (!cache) return null;
  cache = JSON.parse(cache);
  return cache;
};

/**
 * @description Asynchronously sets a value in Redis with a specified time-to-live
 * (TTL) and prefix. If no TTL is provided, it defaults to a predefined `_redisTTL`.
 * The value is stored as JSON string representation of the input data.
 *
 * @param {string} name - Used to identify cached data.
 *
 * @param {any} data - Expected to hold the data to be cached.
 */
const doCache = async (name: string, data: any, ttl?: number) => {
  if (!_redis) return;
  await _redis.setEx(_redisPrefix + ':' + name, ttl ? ttl : _redisTTL, JSON.stringify(data));
};

/**
 * @description Retrieves JSON data from a URL, first checking if it's cached using
 * Redis. If not cached, it fetches and parses the data, then caches it for future
 * use. It returns the parsed JSON data or throws an error if caching fails.
 *
 * @param {string} url - Used to fetch JSON data from a URL.
 *
 * @returns {object} A JSON representation of data fetched from the specified URL.
 * If caching is successful, it returns cached data; otherwise, it fetches and caches
 * new data before returning it.
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
 * @description Retrieves a blob from a URL, either by fetching it directly or by
 * checking a cache first. If cached, it returns the cached blob; otherwise, it fetches
 * and caches the blob before returning it.
 *
 * @param {string} url - Used as the URL to fetch.
 *
 * @returns {Blob} A representation of an immutable, in-memory binary data as a blob
 * or other format.
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
 * @description Retrieves transactions from a provided feature tree, which contains
 * an array or string of transaction addresses. It filters and aggregates these
 * transactions based on their stake addresses, returning them as an object with stake
 * addresses as keys and arrays of transactions as values.
 *
 * @param {{ transactions: string[] | string }} featureTree - Used to hold an array
 * or a single string of transaction addresses.
 *
 * @param {string} walletAddr - Referred to as the wallet address.
 *
 * @returns {Promise<object>} An object where each property has a stake address as
 * its key and an array of transactions related to that stake address as its value.
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
 * @description Retrieves transactions from a specific stake address, filtering by
 * valid contracts and stake view. It returns a paginated list of transactions, caching
 * the results to optimize performance.
 *
 * @param {string} stakeAddress - Used to filter transactions by stake address.
 *
 * @param {number} page - Used to specify a specific page of transactions to retrieve.
 *
 * @returns {Promise<any>} An array of JSON objects containing transaction information
 * such as hash, out_sum, fee, deposit, size, and other details.
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
 * @description Retrieves an Ada handle associated with a given wallet address from
 * a PostgreSQL database. It checks the cache first, then queries the database using
 * a SQL statement to find the handle, and finally caches the result for future use.
 *
 * @param {string} walletAddr - A wallet address.
 *
 * @returns {Promise<object | null>} Either a string representing an Ada handle in
 * ASCII and Unicode formats if found, or null if no matching handle exists.
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
 * @description Retrieves a list of tokens associated with a feature tree and a wallet
 * address, and returns them as an object. It iterates over the token list, gets stake
 * addresses from any format, fetches assets from those stakes, and stores them in
 * the output object.
 *
 * @param {{ tokens: string[] | string }} featureTree - Required to provide tokens
 * for which tokens should be retrieved.
 *
 * @param {string} walletAddr - Intended for wallet address processing.
 *
 * @returns {Promise<object>} An object containing a mapping from stake addresses to
 * lists of assets.
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
 * @description Retrieves tokens from a specified address or stake address. If the
 * provided address is valid, it calls `getStakeFromAny` to obtain the stake address
 * and then uses it to fetch tokens with `getTokensFromStake`.
 *
 * @param {string} address - Required for processing tokens.
 *
 * @param {number} page - Used for pagination.
 *
 * @returns {Promise<{ unit: string; quantity: number }[] | null>} An array of objects
 * containing a unit and a quantity, or null if no tokens are found.
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
 * @description Retrieves tokens from a specified stake address, optionally filtering
 * by policies, and returns an array of objects containing token units and quantities.
 * It utilizes caching to optimize performance.
 *
 * @param {string} stakeAddress - Used to filter assets by their stake address.
 *
 * @param {number} page - Used to specify pagination.
 *
 * @param {boolean} policies - Used to filter tokens by policies or names.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing a "unit" and a "quantity".
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
 * @description Retrieves a list of unique policies from a specified stake address,
 * along with their quantities, by calling another asynchronous function `getTokensFromStake`.
 * The function takes two parameters: the stake address and an optional page number.
 *
 * @param {string} stakeAddress - Required to specify a stake address.
 *
 * @param {number} page - Used to specify pagination for token retrieval.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing a string "unit" and a number "quantity".
 */
export async function getUniquePoliciesFromStake(
  stakeAddress: string,
  page: number = 0,
): Promise<{ unit: string; quantity: number }[]> {
  return await getTokensFromStake(stakeAddress, page, true);
}

/**
 * @description Retrieves a list of tokens from a specified policy using PostgreSQL
 * queries. It checks a cache for previously retrieved results and if not found,
 * executes a query to fetch tokens, groups them by policy and name, filters out
 * zero-quantity tokens, and caches the result.
 *
 * @param {string} policyId - Required for filtering tokens by policy.
 *
 * @param {number} page - Used to specify a page for pagination results.
 *
 * @returns {Promise<any>} A list of objects containing 'unit' and 'quantity' properties.
 * The 'unit' property is a concatenation of hexadecimal encoded policy and name, and
 * the 'quantity' property is the sum of quantity greater than zero in descending order.
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
 * @description Retrieves policy holders based on a given policy ID, with optional
 * pagination and caching. It fetches data from a PostgreSQL database, groups and
 * orders it by stake address, and returns the result as a Promise.
 *
 * @param {string | string[]} policyId - Used to filter policies by specific IDs or
 * multiple IDs.
 *
 * @param {number} page - Used to specify a page of policy holders.
 *
 * @returns {Promise<any>} An array of objects containing two properties: `quantity`
 * and `stake`. Each object represents a policy holder with their total quantity and
 * stake address.
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
 * @description Retrieves a list of token holders for a specified unit and page. It
 * fetches data from the database, caches the result, and returns it as a promise.
 * The list is sorted by the total quantity held by each holder in descending order.
 *
 * @param {string} unit - Used to filter token holders based on the given unit.
 *
 * @param {number} page - Used to specify the page of token holders to retrieve.
 *
 * @returns {Promise<any>} An array of objects containing information about token
 * holders, including their address, stake, and total quantity of tokens held.
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
 * @description Retrieves a list of unspent transaction outputs (UTXOs) from multiple
 * stakeholders based on a feature tree and returns them as an object with stake
 * addresses as keys.
 *
 * @param {{ utxos: string[] | string }} featureTree - Used to specify the UTXO addresses.
 *
 * @param {string} walletAddr - Used as the stake address.
 *
 * @returns {Promise<any>} An object that contains a set of UTXO data grouped by stake
 * addresses as keys.
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
 * @description Retrieves unspent transaction outputs (UTXOs) associated with a
 * specified stake address. It uses an underlying `_pgClient` to fetch data and returns
 * an array of UTXO objects, each containing details such as transaction hash, index,
 * value, and other metadata.
 *
 * @param {string} stakeAddress - Used to specify the address for which UTXOs are retrieved.
 *
 * @param {number} page - Used to specify a page of UTXOs.
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
 * >} An array of objects containing various details about unspent transaction outputs
 * (UTXOs).
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
 * @description Retrieves a list of Unspent Transaction Outputs (UTXOs) associated
 * with a given Bitcoin address from a PostgreSQL client. It returns an array of
 * objects containing UTXO details, such as transaction hash, index, and value, along
 * with optional multiasset and datum information.
 *
 * @param {string} baseAddress - Required for retrieving UTXO data from an address.
 *
 * @param {number} page - Used to specify a page of UTXO results.
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
 * @description Retrieves a list of unspent transaction outputs (UTXOs) from a
 * PostgreSQL database based on either a stake address or a base address, and returns
 * them as an array of objects containing details such as the transaction hash, index,
 * value, and multiasset data.
 *
 * @param {string | null} stakeAddress - Used to filter UTXOs by stake address.
 *
 * @param {string | null} baseAddress - Optional by default. It is used to filter
 * UTXOs based on their address.
 *
 * @param {number} page - Used to specify the page number for pagination.
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
 * >} A promise that resolves to an array of objects representing utxo information.
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
 * @description Retrieves and processes information about a list of libraries from
 * an API, filters out unwanted files, downloads and decodes their contents, and
 * categorizes them as JavaScript or CSS scripts to be returned as part of the result.
 *
 * @param {{
 *   libraries: { name: string; version: string }[];
 * }} featureTree - Used to hold information about libraries.
 *
 * @returns {Promise<{ libraries: string[]; css: string[] }>} An object with two
 * properties: "libraries" and "css". These properties are arrays of strings representing
 * URLs of JavaScript files and CSS stylesheets respectively.
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
 * @description Retrieves metadata for a given unit. If the unit does not conform to
 * CIP68, it attempts to fetch mint transaction data and extract relevant metadata.
 * If the unit conforms to CIP68, it calls another function to retrieve metadata.
 * Returns null if no metadata is found.
 *
 * @param {string} unit - Required for fetching metadata.
 *
 * @returns {Promise<any>} Resolved to either null or an object containing metadata
 * information.
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
 * @description Retrieves a mint transaction and its metadata from a PostgreSQL
 * database. It first checks if the unit is 'Un-minted', then caches or fetches the
 * data based on cache availability, and finally returns the transaction hash and
 * metadata in JSON format.
 *
 * @param {string} unit - Intended to specify a unit for retrieving mint transaction
 * data.
 *
 * @returns {Promise<{ txHash: string; metadata: { key: string; json: object }[] } |
 * null>} Either an object containing a transaction hash and an array of metadata
 * objects or null.
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
 * @description Retrieves and parses CIP-68 metadata for a given unit from a PostgreSQL
 * database, using caching to improve performance. It returns the parsed metadata as
 * a JSON-like object or null if no data is found.
 *
 * @param {string} unit - 112 bytes long, representing a unique identifier.
 *
 * @returns {Promise<any>} Either an object (metadata) containing key-value pairs
 * where keys are hexadecimal strings and values can be null, string, array, or
 * objects, or a boolean false in case of an error, or null if no data is found.
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
     * @description Converts a CBOR-encoded JSON list into a JavaScript array. It recursively
     * traverses the input list, parsing and extracting values from nested maps, bytes,
     * and lists, and returns an equivalent JavaScript array representation of the original
     * data.
     *
     * @param {any} list - Expected to be a list of objects containing CBOR data.
     *
     * @returns {any} A list of values parsed from the input CBOR data. The returned list
     * may contain strings, buffers, or recursively parsed lists and maps.
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
     * @description Converts a CBOR map to a JSON object. It iterates through each field
     * in the map, checks its type (bytes, list, or map), and recursively calls itself
     * if necessary. The converted values are stored in a new JSON object with keys
     * generated from the original CBOR key bytes.
     *
     * @param {any} map - Expected to contain key-value pairs in CBOR format.
     *
     * @returns {any} An object with key-value pairs where keys are hexadecimal strings
     * and values can be null, string, list of objects, or another map of objects.
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
 * @description Retrieves a list of file metadata and returns an array of objects
 * containing the source, media type, and other properties for each file. The function
 * also handles unit changes and returns files with updated information.
 *
 * @param {string} unit - Used to filter file metadata.
 *
 * @returns {Promise<{ src: string; mediaType: string }[]>} An array of objects with
 * two properties: `src` and `mediaType`, both of type string.
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
 * @description Converts a given blob to a URL-encoded data URI, allowing for the
 * representation of binary data within a string. It achieves this by converting the
 * blob to an array buffer, then decoding it as text and combining it with the blob's
 * MIME type.
 *
 * @param {Blob} blob - Used to convert a blob into a URL-encoded data URL.
 *
 * @returns {string} A URL-encoded data URI that represents the blob as a file source,
 * suitable for use in an HTML attribute such as the `src` attribute of an `<img>`
 * tag or a CSS background-image.
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
 * @description Converts a Blob object into a data URL, which can be used to display
 * or transmit binary data over HTTP or HTTPS protocols. The function takes a Blob
 * as an input and returns a string representing the data URL.
 *
 * @param {Blob} blob - Required for processing.
 *
 * @returns {Promise<string>} A URL that can be used to display an image or any other
 * binary data within a web page, in base64-encoded format.
 */
export const getDataURLFromBlob = async (blob: Blob): Promise<string> => {
  const arrayBuf = await blob.arrayBuffer();
  const mType = blob.type.split(';')[0];
  return 'data:' + mType + ';base64,' + Buffer.from(arrayBuf).toString('base64'); // Currently not using the function above because I have no prob
};
/**
 * @description Takes an array of file objects or strings, a unit, and metadata as
 * input. It asynchronously retrieves files from various sources, processes them, and
 * returns a promise with a result object containing processed files grouped by the
 * specified unit.
 *
 * @param {string} unit - Used to identify the unit for which files are being retrieved.
 *
 * @param {({ src?: string; mediaType?: string; id?: string | number } | string)[]}
 * files - Used to iterate through files to be processed.
 *
 * @param {any} metadata - Not used within the function's logic.
 *
 * @returns {Promise<any>} An object that can contain a unit as property key and a
 * value of either an array of objects representing files or an error message. The
 * error message is stored in the 'error' property if any file fails to download.
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
 * @description Retrieves a file from various sources (IPFS, ARWeave, data URLs,
 * HTTP/HTTPS) and returns its buffer content along with metadata such as media type,
 * ID, unit, and props. It handles different types of URLs and data formats to fetch
 * the file successfully.
 *
 * @param {string} src - The source URL or identifier of the file to retrieve.
 *
 * @param {string} mediaType - Optional. It specifies the media type of the file.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; id?: string | number; unit?:
 * string; props?: any }>} An object with properties buffer, mediaType, id, unit and
 * props.
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
    const res = await axiosGet(IPFS_GATEWAY + src.substring(14), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (
    src.substring(0, 12) === 'ipfs://ipfs:' ||
    src.substring(0, 12) === 'ipfs:ipfs://' ||
    src.substring(0, 12) === 'ipfs://ipfs/'
  ) {
    const res = await axiosGet(IPFS_GATEWAY + src.substring(12), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 7) === 'ipfs://') {
    const res = await axiosGet(IPFS_GATEWAY + src.substring(7), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
    /*
  } else if (multihash.validate(Uint8Array.from(Buffer.from(src).alloc((46))))) {
    const res = await axiosGet(IPFS_GATEWAY + src, { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;*/
  } else if (src.substring(0, 5) === 'ar://') {
    const res = await axiosGet(ARWEAVE_GATEWAY + src.substring(5), { responseType: 'arraybuffer' });
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
    const res = await axiosGet(src, { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 7) === 'http://') {
    const res = await axiosGet(src, { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 5) === 'ipfs/') {
    const res = await axiosGet(IPFS_GATEWAY + src.substring(5), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.substring(0, 6) === '/ipfs/') {
    const res = await axiosGet(IPFS_GATEWAY + src.substring(6), { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  } else if (src.length === 46) {
    // ipfs hash is 46 bytes long, sometimes people get confused
    const res = await axiosGet(IPFS_GATEWAY + src, { responseType: 'arraybuffer' });
    if (!result.mediaType) result.mediaType = res.headers['content-type'];
    result.buffer = res.data;
  }
  return result;
};

/**
 * @description Retrieves a file based on the provided unit, ID, and metadata. It
 * checks for files with matching IDs in the metadata and returns a promise containing
 * the file's buffer, media type, and other properties.
 *
 * @param {string} unit - Used to determine metadata source.
 *
 * @param {string | number | null} id - Used to identify a file within metadata or
 * token metadata.
 *
 * @param {any | null} metadata - Used to provide additional information about files
 * or tokens.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; props?: any; unit?: string;
 * id?: string; src?: string }>} An object containing a file's properties, such as
 * its buffer, media type, and additional metadata.
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
 * @description Retrieves a list of addresses, along with their corresponding quantities,
 * related to a specified unit (e.g., cryptocurrency) from a PostgreSQL database. It
 * also caches query results for performance optimization and provides an alternative
 * method using the Blockfrost API if needed.
 *
 * @param {string} unit - Used to filter addresses by unit.
 *
 * @param {number} count - Used to specify the number of addresses to return.
 *
 * @returns {Promise<{ address: string; quantity: number }[]>} An array of objects
 * containing "address" and "quantity" properties.
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
 * @description Retrieves smart contract-related data from a feature tree object and
 * combines it into a single response object. It fetches libraries, tokens, UTXOs,
 * transactions, and files depending on the input parameters, and returns the aggregated
 * data.
 *
 * @param {{
 *     libraries: { name: string; version: string }[];
 *     tokens: string[] | string;
 *     utxos: string[] | string;
 *     transactions: string[] | string;
 *     mintTx?: boolean;
 *     files?: boolean | string | ({ src?: string; mediaType?: string } | string)[];
 *   }} featureTree - Used to define the structure of smart imports.
 *
 * @param {any} metadata - Unused.
 *
 * @param {string} walletAddr - Used to represent the owner's wallet address.
 *
 * @param {string} tokenUnit - Used to specify a token unit.
 *
 * @returns {any} An object containing various properties such as libraries, css,
 * tokens, utxos, transactions, ownerAddr, fetchedAt, tokenUnit and libcip54Version.
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
 * @description Takes a base address as input, validates it, and returns its stake
 * representation as a lowercase string. If the base address is not a stake address,
 * it converts it to a stake address based on the network ID (mainnet or testnet).
 *
 * @param {string} baseAddress - Required to calculate the stake.
 *
 * @returns {string | null} Either a lowercase string representing a stake address
 * or null if the input address is invalid.
 */
export function getStake(baseAddress: string): string | null {
  ensureInit();
  const Addr = validAddress(baseAddress);
  if (!Addr) return null;
  if (!(Addr instanceof StakeAddress)) {
    return new StakeAddress(_networkId === 1 ? 'mainnet' : 'testnet', Addr.paymentCreds.hash, 'script')
      .toString()
      .toLowerCase();
  } else {
    return Addr.toString().toLowerCase();
  }
}

/**
 * @description Takes an address as input, retrieves its stake using the `getStake`
 * function, and returns the result as a lowercase string if it is not null; otherwise,
 * it returns null.
 *
 * @param {string} address - Expected to be an Ethereum address.
 *
 * @returns {string | null} Either a lowercase string representation of the stake
 * address or null if the address is invalid.
 */
export function getStakeFromAny(address: string): string | null {
  // Todo - make this support address being a CSL address object
  const Addr = getStake(address);
  if (!Addr) return null;
  return Addr.toString().toLowerCase();
}

/**
 * @description Generates a base address for a payment and stake combination. It uses
 * the network ID to determine whether it's the mainnet or testnet, then creates an
 * `Address` object with a credential for the payment and stake keys. The address is
 * converted to lowercase and returned as a string.
 *
 * @param {string} payment - 28 characters long, representing a payment key hash.
 *
 * @param {string} stake - Referred to as the stake key.
 *
 * @returns {string} A lower-case string representation of an Address object.
 */
export function getBaseAddress(payment: string, stake: string): string {
  ensureInit();
  return new Address(
    _networkId === 1 ? 'mainnet' : 'testnet',
    new Credential(CredentialType.KeyHash, new Hash28(payment)),
    new StakeCredentials('stakeKey', new Hash28(stake)),
  )
    .toString()
    .toLowerCase();
}

/**
 * @description Converts a given `address` parameter, which can be either a string
 * or an array of bytes, into a valid `StakeAddress` or `Address`. It tries different
 * conversion methods and returns the first successful result; if all attempts fail,
 * it throws an error.
 *
 * @param {string | byte[]} address - Expected to be an address.
 *
 * @returns {StakeAddress | Address} Either a StakeAddress object or an Address object,
 * depending on whether the input address is valid as one or the other.
 */
export function validAddress(address: string | byte[]): StakeAddress | Address {
  let ret = null;
  if (typeof address === 'string') {
    try {
      ret = Address.fromString(address);
    } catch (e) {}
    try {
      if (!ret) ret = StakeAddress.fromString(address);
    } catch (e) {}
  }
  try {
    if (!ret) ret = Address.fromBytes(address);
  } catch (e) {}
  try {
    if (!ret) ret = StakeAddress.fromBytes(address);
  } catch (e) {}
  if (!ret) throw new Error('Invalid address: ' + address);
  return ret;
}
/**
 * @description Checks if a given address is valid by attempting to validate it with
 * the `validAddress` function. If an error occurs during validation, the function
 * sets the result to false; otherwise, it returns true.
 *
 * @param {string} address - To be validated for its validity.
 *
 * @returns {boolean} True if the address is valid and false otherwise.
 */
export function isValidAddress(address: string): boolean {
  let ret = false;
  try {
    validAddress(address);
    ret = true;
  } catch (e) {}
  return ret;
}

/**
 * @description Checks whether a given string represents a valid Bech32-encoded
 * address. If the address is invalid, it throws an error; otherwise, it returns
 * either a `StakeAddress` or `Address` object depending on the specific implementation
 * of `validAddress`.
 *
 * @param {string} address - A bech32 address to validate.
 *
 * @returns {StakeAddress | Address} Either a StakeAddress or an Address object.
 */
export function validBech32Address(address: string): StakeAddress | Address {
  if (!isBech32(address)) throw new Error('Invalid bech32 address');
  return validAddress(address);
}
/**
 * @description Checks whether a given string is a valid Bech32 address by attempting
 * to validate it using the internal `validBech32Address` function. If validation
 * succeeds, the function returns `true`; otherwise, it returns `false`.
 *
 * @param {string} address - Expected to be a Bech32-encoded address.
 *
 * @returns {boolean} True if the given Bech32 address is valid and false otherwise.
 */
export function isValidBech32Address(address: string): boolean {
  let ret = false;
  try {
    validBech32Address(address);
    ret = true;
  } catch (e) {}
  return ret;
}

/**
 * @description Determines and returns the type of a given address, which can be
 * either a string or an instance of `Address` or `StakeAddress`. It checks the type
 * of the address and returns one of the following types: 'Base', 'Pointer', 'Enterprise',
 * 'Bootstrap', or 'Stake'.
 *
 * @param {string | Address | StakeAddress} address - Used to determine the address
 * type.
 *
 * @returns {'Base' | 'Pointer' | 'Enterprise' | 'Bootstrap' | 'Stake'} A string
 * literal that represents one of five possible address types: Base, Pointer, Enterprise,
 * Bootstrap, or Stake.
 */
export function addressType(
  address: string | Address | StakeAddress,
): 'Base' | 'Pointer' | 'Enterprise' | 'Bootstrap' | 'Stake' {
  let Addr;
  if (typeof address === 'string') {
    Addr = validAddress(address);
  } else {
    Addr = address;
  }
  if (Addr instanceof Address) {
    switch (Addr.type) {
      case 'base':
        return 'Base';
      case 'pointer':
        return 'Pointer';
      case 'enterprise':
        return 'Enterprise';
      case 'bootstrap':
        return 'Bootstrap';
      default:
        throw new Error('Invalid Address type: ' + Addr.type);
    }
  } else if (Addr instanceof StakeAddress) {
    return 'Stake';
  } else {
    throw new Error('Invalid address type');
  }
}

/**
 * @description Determines whether a given label is either `REFERENCE_TOKEN_LABEL`
 * or `USER_TOKEN_LABEL`. If the input `label` is falsy, it returns `false`. Otherwise,
 * it checks if the `label` matches one of these two specific values and returns
 * `true` if so.
 *
 * @param {number} label - Expected to be a label value.
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
 * @description Converts a given number into a hexadecimal label format by adding a
 * prefix and suffix, ensuring that the input is within the valid range (1-65535),
 * and calculates a checksum using the provided number as input.
 *
 * @param {number} num - 16-bit unsigned integer.
 *
 * @returns {string} 7 characters long and has a specific format: '0xxxxxx0', where
 * 'x' represents a hexadecimal digit.
 */
export function toLabel(num: number): string {
  if (num < 0 || num > 65535) {
    throw new Error(`Label ${num} out of range: min label 1 - max label 65535.`);
  }
  const numHex = num.toString(16).padStart(4, '0');
  return '0' + numHex + checksum(numHex) + '0';
}

/**
 * @description Converts a string representing an EAN-8 barcode into a numeric value
 * if it is valid, or returns null otherwise. It checks the length and format of the
 * input string, calculates a checksum, and compares it to the actual checksum in the
 * label.
 *
 * @param {string} label - 8 characters long.
 *
 * @returns {number | null} Either a decimal integer representing the parsed hexadecimal
 * number if the checksum is valid, or null if the input string does not conform to
 * expected format or has an invalid checksum.
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
 * @description Converts a given hexadecimal string to a Uint8Array buffer. It takes
 * a string as input, decodes it from hexadecimal format using the provided 'hex'
 * encoding scheme, and returns the resulting binary data as a Uint8Array object.
 *
 * @param {string} hex - Expected to contain hexadecimal data.
 *
 * @returns {Uint8Array} A sequence of unsigned 8-bit integers that are encoded as
 * an array-like object of numbers. Each element in the array represents the binary
 * representation of a hexadecimal digit.
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
 * @description Calculates a cyclic redundancy check (CRC) for an input `Uint8Array`.
 * It takes an initial value (`previous`) and updates it by XORing each byte of the
 * array with the current CRC, then using the resulting value as an index into a
 * lookup table to generate the next CRC.
 *
 * @param {Uint8Array} current - Used to calculate the cyclic redundancy check (CRC).
 *
 * @param {number} previous - The initial CRC value to be used for calculation.
 *
 * @returns {number} 8-bit cyclic redundancy check (CRC) checksum calculated for the
 * input data.
 */
export function crc8(current: Uint8Array, previous = 0): number {
  let crc = ~~previous;

  for (let index = 0; index < current.length; index++) {
    crc = TABLE[(crc ^ current[index]) & 0xff] & 0xff;
  }

  return crc;
}

/**
 * @description Converts a Base64-encoded string to its corresponding Unicode code
 * point representation. It first decodes the Base64 string, then maps each character
 * to its Unicode code point, and finally joins the results into a single string with
 * each code point escaped as a percentage encoding.
 *
 * @param {string} str - Expected to be a Base64-encoded string.
 *
 * @returns {string} A decoded representation of the input Base64-encoded string,
 * where each character is represented as its corresponding Unicode code point in
 * hexadecimal format with leading zeros (e.g., `%u0123`).
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
 * of hexadecimal characters, converting them to a Unicode character using
 * `String.fromCharCode`, and concatenating the results into a final ASCII string.
 *
 * @param {string} str1 - Hexadecimal string to be converted.
 *
 * @returns {string} A sequence of characters resulting from converting hexadecimal
 * digits to ASCII characters.
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
 * @description Converts a given string from Unicode to Base64 format by encoding it
 * with UTF-8 and then applying Base64 encoding using the `btoa` function. Additionally,
 * it replaces any escaped Unicode characters with their corresponding solid bytes.
 *
 * @param {string} str - Subject to encoding conversion.
 *
 * @returns {string} The base64 encoded representation of the input string after
 * replacing non-ASCII characters with their corresponding solid bytes.
 */
export function unicodeToBase64(str: string) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function toSolidBytes(match, p1) {
      // Converts hexadecimal characters to ASCII characters.

      return String.fromCharCode(Number('0x' + p1));
    }),
  );
}
/**
 * @description Converts a given Data URI (data URI) to a string, handling different
 * encoding schemes including Base64 and UTF-8 with URL-safe characters, returning
 * the decoded byte string representation of the original data.
 *
 * @param {string} dataURI - Used to convert data URIs into strings.
 *
 * @returns {string} A decoded representation of the input data URI.
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
 * @description Converts a given string into its hexadecimal representation by iterating
 * through each character, calculating its ASCII code using `charCodeAt`, and then
 * converting it to a hexadecimal string before joining all results together.
 *
 * @param {string} str - Expected to hold a string value.
 *
 * @returns {string} A concatenation of hexadecimal representations of ASCII values
 * of all characters in the input string.
 */
export function asciiToHex(str: string) {
  const arr1 = [];
  for (let n = 0, l = str.length; n < l; n++) {
    const hex = Number(str.charCodeAt(n)).toString(16);
    arr1.push(hex);
  }
  return arr1.join('');
}
