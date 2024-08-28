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
  StakeKeyHash,
  StakeValidatorHash,
  StakeCredentialsType,
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
 * @description Initializes a set of variables with provided parameters, including
 * network ID, PostgreSQL client, IPFS and Arweave gateways, Redis client, prefix,
 * time-to-live (TTL), and timeout. It sets up the variables to be used in subsequent
 * operations.
 *
 * @param {'mainnet' | 'testnet'} networkId - Used to specify whether the application
 * operates on mainnet or testnet.
 *
 * @param {pgCon.Client} connection - Used to initialize a PostgreSQL client connection.
 *
 * @param {string | null} ipfsGateway - Used to set an IPFS gateway URL.
 *
 * @param {string | null} arweaveGateway - Used to set an Arweave gateway.
 *
 * @param {RedisClientType | null} redis - Used to connect to Redis.
 *
 * @param {string} redisPrefix - Used to prefix keys in Redis storage.
 *
 * @param {number} redisTTL - Used to specify time-to-live for Redis keys.
 *
 * @param {number} getTimeout - Used to set the timeout for API requests.
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
 * @description Wraps the `axios.get` method to make a GET request to a specified URL
 * with optional configuration. It sets a timeout and signal for the request, ensuring
 * it aborts after a certain time if not completed. The response is returned as a promise.
 *
 * @param {string} url - Used for specifying the URL to make a GET request to.
 *
 * @returns {Promise<AxiosResponse>} A promise that resolves to an AxiosResponse object.
 */
const axiosGet = async (url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> => {
  return await axios.get(url, { ...config, timeout: _getTimeout, signal: AbortSignal.timeout(_getTimeout) });
};

/**
 * @description Checks whether `_pgClient` and `_networkId` are initialized. If not,
 * it throws an error with a specific message indicating that initialization is
 * required before using the library.
 */
const ensureInit = () => {
  if (!_pgClient || !_networkId) throw new Error('Libcip54 error - please initialize before use');
};

/**
 * @description Returns a value representing a timeout period, which is stored in the
 * `_getTimeout` variable. This suggests that it is part of a larger system for
 * handling queries or requests with a specified time limit.
 *
 * @returns {number} `_getTimeout`.
 */
export const queryGetTimeout = (): number => {
  return _getTimeout;
};

/**
 * @description Exports a constant that sets the default timeout value to the specified
 * milliseconds (`ms`) when called. If no argument is provided, it defaults to 2000
 * milliseconds (2 seconds). The set value can be accessed via the `_getTimeout` variable.
 *
 * @param {number} ms - Used to set a timeout.
 */
export const setGetTimeout = (ms: number = 2000) => {
  _getTimeout = ms;
};

/**
 * @description Retrieves and parses cached data for a given `name` from Redis using
 * the `_redisPrefix + ':' + name` key. If no cached data is found, it returns null.
 * Otherwise, it returns the parsed JSON data.
 *
 * @param {string} name - Used to identify cached data.
 *
 * @returns {object} Parsed from a JSON string retrieved from Redis storage, if such
 * cache exists; otherwise, it returns null.
 */
const checkCache = async (name: string) => {
  if (!_redis) return null;
  let cache: any = await _redis.get(_redisPrefix + ':' + name);
  if (!cache) return null;
  cache = JSON.parse(cache);
  return cache;
};

/**
 * @description Sets a value with a time-to-live (TTL) in Redis cache storage. It
 * takes a name, data to be stored, and an optional TTL. If no TTL is provided, it
 * uses the default TTL set by `_redisTTL`. The cached value is stored as a JSON string.
 *
 * @param {string} name - Used to identify cached data.
 *
 * @param {any} data - A value to be stored in Redis cache.
 */
const doCache = async (name: string, data: any, ttl?: number) => {
  if (!_redis) return;
  await _redis.setEx(_redisPrefix + ':' + name, ttl ? ttl : _redisTTL, JSON.stringify(data));
};

/**
 * @description Fetches JSON data from a given URL and caches it for future requests.
 * If the cache is available, it returns the cached data; otherwise, it makes an HTTP
 * request to the URL, parses the response as JSON, and caches the result before
 * returning it.
 *
 * @param {string} url - Used to fetch JSON data from the specified URL.
 *
 * @returns {object} JSON data fetched from the specified URL either by fetching from
 * cache or by retrieving it fresh and then caching it for future use.
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
 * @description Fetches a blob from a URL. If a Redis cache is available, it checks
 * for cached results. If not, it fetches the blob directly and caches it. The function
 * returns the fetched blob.
 *
 * @param {string} url - The URL to fetch the blob from.
 *
 * @returns {Blob} A binary data object that represents an immutable buffer of bytes.
 * The Blob can be used to create an image or other multimedia object.
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
 * @description Retrieves a collection of transactions associated with a wallet address
 * or stake addresses from a feature tree and returns them as an object. It handles
 * cases where the feature tree contains a single string or an array of strings
 * representing transaction IDs.
 *
 * @param {{ transactions: string[] | string }} featureTree - Used to store transaction
 * data.
 *
 * @param {string} walletAddr - Used as a default stake address when necessary.
 *
 * @returns {Promise<object>} An object where the properties are stake addresses and
 * their corresponding transaction values, if any transactions were found for those
 * stake addresses.
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
 * @description Retrieves transactions from a specified stake address, caching the
 * result if it exists. It returns an array of transaction data, including hashes,
 * values, and metadata, with optional pagination.
 *
 * @param {string} stakeAddress - Used to filter transactions by stake address.
 *
 * @param {number} page - Used to specify a page number for pagination.
 *
 * @returns {Promise<any>} An array of objects containing information about transactions
 * from a specific stake address. The returned data includes transaction details such
 * as hash, output sums, fees, deposit amounts, and block information.
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
 * @description Retrieves an Ada handle associated with a given wallet address. It
 * checks for cached results, fetches data from a PostgreSQL database, and processes
 * it to extract the handle if available. If not, it returns null.
 *
 * @param {string} walletAddr - The address of a wallet.
 *
 * @returns {Promise<object | null>} Either an object representing a handle in ASCII
 * format or null if no handle was found for the given wallet address.
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
 * @description Retrieves tokens associated with a wallet address or 'own' for the
 * wallet itself, from a feature tree containing token addresses. It calls `getStakeFromAny`
 * to resolve stake addresses and then fetches assets using `getTokensFromStake`,
 * returning them as an object.
 *
 * @param {{ tokens: string[] | string }} featureTree - Used to specify the list of
 * tokens to be retrieved.
 *
 * @param {string} walletAddr - Used to determine the stake address for a specific token.
 *
 * @returns {Promise<object>} An asynchronous operation that resolves to an object
 * containing stake addresses as keys and arrays of tokens as values.
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
 * @description Retrieves a list of tokens from an input address. It first converts
 * the input address to a stake address using `getStakeFromAny`. If successful, it
 * calls `getTokensFromStake` with the converted stake address and a page number. If
 * conversion fails, it returns null.
 *
 * @param {string} address - Required to initiate the process.
 *
 * @param {number} page - Used to specify a page number for pagination.
 *
 * @returns {Promise<{ unit: string; quantity: number }[] | null>} An array of objects
 * containing a 'unit' and a 'quantity', or null if no tokens are found.
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
 * @description Retrieves tokens associated with a specified stake address from a
 * PostgreSQL database, optionally filtering by policies. It caches query results and
 * supports pagination. The function returns an array of objects containing token
 * units and quantities.
 *
 * @param {string} stakeAddress - Used to filter the query result by stake address.
 *
 * @param {number} page - Used to specify pagination.
 *
 * @param {boolean} policies - Used to specify whether or not to group results by policy.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing two properties: "unit" and "quantity", representing a token's unique
 * identifier and quantity respectively.
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
 * @description Retrieves a list of unique policies from a specified stake address
 * asynchronously. It calls another function `getTokensFromStake`, passing the stake
 * address, page number (default is 0), and a boolean flag set to true, to obtain the
 * policies.
 *
 * @param {string} stakeAddress - Used to specify the address of a stake.
 *
 * @param {number} page - Used to specify pagination.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing a "unit" property with a string value and a "quantity" property with a
 * numeric value.
 */
export async function getUniquePoliciesFromStake(
  stakeAddress: string,
  page: number = 0,
): Promise<{ unit: string; quantity: number }[]> {
  return await getTokensFromStake(stakeAddress, page, true);
}

/**
 * @description Retrieves a list of tokens from a policy in a database, caches the
 * result for future requests with the same parameters, and returns the token information
 * as an array.
 *
 * @param {string} policyId - Used to filter tokens based on policy ID.
 *
 * @param {number} page - Used for pagination.
 *
 * @returns {Promise<any>} A collection of objects containing two properties: "unit"
 * and "quantity", representing tokens from a given policy, with quantities summed
 * and sorted in descending order.
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
 * @description Retrieves a list of policy holders for a given policy or multiple
 * policies, with optional pagination. It checks the cache first and then queries the
 * database using PostgreSQL. The result is sorted by quantity in descending order
 * and limited to 20 records per page.
 *
 * @param {string | string[]} policyId - Required for filtering policy holders.
 *
 * @param {number} page - Used for pagination.
 *
 * @returns {Promise<any>} An array of rows from a database query result, containing
 * aggregated data about policy holders. Each row represents a unique stake address
 * and includes columns for quantity and stake.
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
 * @description Retrieves and caches the token holders for a given multi-asset (unit)
 * by querying the PostgreSQL database, grouping results by address, sorting by total
 * quantity, and limiting the output to a specified page size.
 *
 * @param {string} unit - Used to filter token holders based on a specific unit.
 *
 * @param {number} page - Used to specify a page number for token holders data.
 *
 * @returns {Promise<any>} An array of objects containing address, stake, and quantity
 * information about token holders, grouped by address and ordered in descending order
 * of total quantity held.
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
 * @description Retrieves UTXOs (unspent transaction outputs) from a feature tree and
 * returns them as a promise. It iterates through an array of UTXO strings, extracts
 * stake addresses, fetches corresponding UTXOs, and aggregates them into a return object.
 *
 * @param {{ utxos: string[] | string }} featureTree - Used to specify UTXO identifiers.
 *
 * @param {string} walletAddr - Used as an address for a wallet.
 *
 * @returns {Promise<any>} An object where each property represents a stake address
 * and its corresponding UTXOs.
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
 * specified stake address and returns them as an array of objects containing details
 * such as transaction hash, index, value, multiasset information, and datum. The
 * function also supports pagination.
 *
 * @param {string} stakeAddress - Required to specify the stake address for which
 * UTXO data is needed.
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
 * >} An array of objects representing UTXOs.
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
 * @description Retrieves a list of unspent transaction outputs (UTXOs) associated
 * with a given base address, returning an array of objects containing transaction
 * hash, index, address, value, and other metadata. It uses a Postgres client to query
 * the database.
 *
 * @param {string} baseAddress - The address to retrieve unspent transaction outputs
 * from.
 *
 * @param {number} page - Used for pagination.
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
 * >} An array of objects representing unspent transaction outputs (UTXOs) from a
 * specified base address.
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
 * a stake address or a base address, depending on the input parameters. It filters
 * UTXOs based on the provided address and returns a promise with an array of UTXO
 * objects containing relevant details.
 *
 * @param {string | null} stakeAddress - Used to filter UTXO data based on stake
 * address or null for no filtering.
 *
 * @param {string | null} baseAddress - Optional, used to filter utxos by transaction
 * output address.
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
 * >} An array of objects representing UTXOs (Unspent Transaction Outputs).
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
 * @description Retrieves information about libraries from an API, filters unwanted
 * files based on conditions, and returns a promise containing arrays of JavaScript
 * library sources and CSS file sources.
 *
 * @param {{
 *   libraries: { name: string; version: string }[];
 * }} featureTree - Used to pass an array of library objects with their names and versions.
 *
 * @returns {Promise<{ libraries: string[]; css: string[] }>} An object with two
 * properties: "libraries" and "css". Each property is an array of strings representing
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
 * @description Retrieves metadata for a given unit. It first attempts to extract
 * metadata from the unit itself. If unsuccessful, it tries to fetch metadata from a
 * policy ID using the CIP68 standard. It returns null if no metadata is found or if
 * the unit is invalid.
 *
 * @param {string} unit - Required for fetching metadata.
 *
 * @returns {Promise<any>} A promise that resolves to an object representing metadata
 * about a unit, or null if no metadata can be found.
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
 * @description Retrieves data from a PostgreSQL database about the most recent mint
 * transaction for a given asset unit. It first checks cache and database, then fetches
 * the necessary information and stores it in cache before returning the result.
 *
 * @param {string} unit - Used to identify the specific mint transaction.
 *
 * @returns {Promise<{ txHash: string; metadata: { key: string; json: object }[] } |
 * null>} Either an object with two properties `txHash` and `metadata` or null.
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
 * a SQL query, parses CBOR data into JSON-like objects, and caches the result to
 * reduce future requests.
 *
 * @param {string} unit - 64 characters long.
 *
 * @returns {Promise<any>} Either an object representing metadata, null if no data
 * found, or false on failure or error.
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
     * @description Converts a CBOR list into a JSON array by recursively parsing its
     * elements, which can be CBOR maps, byte strings, or lists. The parsed values are
     * collected and returned as an array.
     *
     * @param {any} list - Expected to be a list of CBOR-encoded JSON objects or values.
     *
     * @returns {any} An array containing a collection of values converted from CBOR
     * (Concise Binary Object Representation) to JSON format.
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
     * @description Converts a CBOR map (a JSON-like object) to a JavaScript object by
     * iterating over its key-value pairs, decoding CBOR data types (bytes, lists, or
     * maps), and storing them as properties in the resulting object.
     *
     * @param {any} map - Expected to be a CBOR map.
     *
     * @returns {any} An object (map) where each key is a string and its corresponding
     * value is either a string, another map, or a list of values converted from CBOR to
     * JSON-compatible format.
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
 * @description Retrieves a list of files associated with a given unit, fetching
 * metadata and actual file data as needed. It returns an array of objects containing
 * file source, media type, and additional properties.
 *
 * @param {string} unit - Used to specify the unit for retrieving files.
 *
 * @returns {Promise<{ src: string; mediaType: string }[]>} A promise resolving to
 * an array of objects containing 'src' and 'mediaType' properties.
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
 * @description Converts a given blob into a URL-encoded data URI string, including
 * the MIME type and base64 encoded binary data. It is designed to be used with images
 * or other binary data that needs to be transmitted over HTTP.
 *
 * @param {Blob} blob - Required for data URL generation.
 *
 * @returns {string} A URL-encoded data URI representing the blob content.
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
 * @description Converts a given Blob into a data URL, which can be used to display
 * or manipulate the blob's content as a string. It extracts the MIME type from the
 * blob and encodes the blob's binary data using Base64 before constructing the data
 * URL.
 *
 * @param {Blob} blob - Expected to hold binary data.
 *
 * @returns {Promise<string>} A URL encoded string representing the blob data in
 * base64 format.
 */
export const getDataURLFromBlob = async (blob: Blob): Promise<string> => {
  const arrayBuf = await blob.arrayBuffer();
  const mType = blob.type.split(';')[0];
  return 'data:' + mType + ';base64,' + Buffer.from(arrayBuf).toString('base64'); // Currently not using the function above because I have no prob
};
/**
 * @description Iterates over an array of files and their metadata. It retrieves file
 * data from sources, processes the data, and organizes it into a hierarchical structure
 * based on the unit and id attributes.
 *
 * @param {string} unit - Used to group files together.
 *
 * @param {({ src?: string; mediaType?: string; id?: string | number } | string)[]}
 * files - Used to fetch files from different sources.
 *
 * @param {any} metadata - Used to store metadata about files.
 *
 * @returns {Promise<any>} An object with properties unit and error. The property
 * unit contains an array of objects that represent files and their metadata. The
 * property error contains an array of error messages if any errors occurred during
 * the execution.
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
 * @description Retrieves a file from various sources such as IPFS, Arweave, and
 * HTTP/HTTPS URLs, and returns a promise with the file's buffer, media type, id,
 * unit, and props. It supports different URL formats and can recursively resolve
 * nested references.
 *
 * @param {string} src - The source URL or reference for the file to be retrieved.
 *
 * @param {string} mediaType - Used to specify the media type of the file being retrieved.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; id?: string | number; unit?:
 * string; props?: any }>} An object that contains a buffer (array-like binary data),
 * a media type, and possibly an ID, unit, or additional props.
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
 * @description Retrieves a file based on the provided unit, ID, and metadata, and
 * returns its buffer, media type, and additional props if available. If the file is
 * not found, it throws an error. It also handles cases where the source is an array
 * or object.
 *
 * @param {string} unit - Used to specify the unit where the file is located.
 *
 * @param {string | number | null} id - Used to specify an identifier for the file
 * being requested.
 *
 * @param {any | null} metadata - Optional.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; props?: any; unit?: string;
 * id?: string; src?: string }>} An object containing a buffer, media type, and
 * optional properties and IDs for the file.
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
 * @description Retrieves a list of addresses associated with a given unit, along
 * with their corresponding quantities, from a PostgreSQL database. It also checks
 * for cached results and updates the cache accordingly.
 *
 * @param {string} unit - Used to filter addresses by a specific blockchain unit.
 *
 * @param {number} count - Used to limit the number of addresses returned by the query.
 *
 * @returns {Promise<{ address: string; quantity: number }[]>} An array of objects
 * containing strings representing addresses and numbers representing quantities.
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
 * @description Retrieves and aggregates data from various sources based on the
 * provided `featureTree` object. It fetches libraries, tokens, UTXOs, transactions,
 * and files, and combines them into a single response object. The function is designed
 * to handle optional parameters and returns the aggregated data.
 *
 * @param {{
 *     libraries: { name: string; version: string }[];
 *     tokens: string[] | string;
 *     utxos: string[] | string;
 *     transactions: string[] | string;
 *     mintTx?: boolean;
 *     files?: boolean | string | ({ src?: string; mediaType?: string } | string)[];
 *   }} featureTree - Used to store data related to libraries, tokens, UTXOs, and
 * other features.
 *
 * @param {any} metadata - Likely used to provide additional data for processing.
 *
 * @param {string} walletAddr - Referred to as an owner address.
 *
 * @param {string} tokenUnit - Used to specify the token unit.
 *
 * @returns {object} An aggregated result containing information about libraries, CSS
 * files, tokens, UTXOs, transactions, mint transaction, and files. The returned
 * object also includes metadata such as fetched date, owner address, token unit, and
 * libcip54 version.
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
 * @description Takes a base address as input and returns a stake address or null if
 * not valid. It determines the stake type (script or stake key) based on the hash
 * and returns a StakeAddress object as a string, converted to lowercase.
 *
 * @param {string} baseAddress - Expected to be an address or a hash.
 *
 * @returns {string | null} Either a lowercase string representation of a StakeAddress
 * object or null if an error occurs during processing.
 */
export function getStake(baseAddress: string): string | null {
  ensureInit();
  const Addr = validAddress(baseAddress);
  let type: StakeCredentialsType = 'stakeKey';
  if (!Addr) return null;
  if (!(Addr instanceof StakeAddress)) {
    let hash: Hash28;
    if (Addr?.stakeCreds?.hash && Addr.stakeCreds.hash instanceof StakeKeyHash) {
      hash = Addr.stakeCreds.hash;
    } else if (Addr?.stakeCreds?.hash && Addr.stakeCreds.hash instanceof StakeValidatorHash) {
      hash = Addr.stakeCreds.hash;
      type = 'script';
    } else {
      hash = Addr?.paymentCreds?.hash;
    }
    return new StakeAddress(_networkId === 1 ? 'mainnet' : 'testnet', hash, type).toString().toLowerCase();
  } else {
    return Addr.toString().toLowerCase();
  }
}

/**
 * @description Retrieves a stake value from an address and returns it as a lowercase
 * string or null if the address is invalid. It first calls another function
 * `getStake(address)` to obtain the stake value, then converts it to a lowercase
 * string before returning it.
 *
 * @param {string} address - Expected to represent an Ethereum address.
 *
 * @returns {string | null} Either a lowercase string representation of an address
 * stake if it exists or null if the address does not have a stake.
 */
export function getStakeFromAny(address: string): string | null {
  // Todo - make this support address being a CSL address object
  const Addr = getStake(address);
  if (!Addr) return null;
  return Addr.toString().toLowerCase();
}

/**
 * @description Generates a base address for a payment and stake pair based on the
 * network ID, using the provided payment and stake strings to create an Address
 * object. It then converts the address to lowercase string format.
 *
 * @param {string} payment - Used to generate an address for payment.
 *
 * @param {string} stake - Used to represent a stake key.
 *
 * @returns {string} A lowercase hexadecimal address generated from the payment and
 * stake hashes, depending on whether the network ID is 1 (mainnet) or not (testnet).
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
 * @description Validates whether a given input is a valid Ethereum address, either
 * as a string or an array of bytes. It attempts to parse the input as both an Ethereum
 * address and a stake address, returning the first successful parsing result.
 *
 * @param {string | byte[]} address - Intended for validation.
 *
 * @returns {StakeAddress | Address} Either a stake address or an address. If the
 * input address is valid, it will be returned as one of these types; otherwise, it
 * throws an error.
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
 * @description Checks whether a given string is a valid address by attempting to
 * call the `validAddress` function with it as an argument. If no error occurs, it
 * returns `true`; otherwise, it returns `false`.
 *
 * @param {string} address - Used to validate an address.
 *
 * @returns {boolean} True if the input address is valid and false otherwise.
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
 * @description Validates a provided string as a Bech32-encoded address and, if valid,
 * returns it as either a StakeAddress or an Address, depending on its type. If
 * invalid, it throws an error.
 *
 * @param {string} address - Expected to be a Bech32 address.
 *
 * @returns {StakeAddress | Address} A union of two types: StakeAddress and Address,
 * indicating that it can be either a stake address or an address.
 */
export function validBech32Address(address: string): StakeAddress | Address {
  if (!isBech32(address)) throw new Error('Invalid bech32 address');
  return validAddress(address);
}
/**
 * @description Checks whether a given string represents a valid Bech32 address. It
 * attempts to parse the address using the `validBech32Address` function, and returns
 * `true` if successful, or `false` otherwise. The parsing is done in a try-catch
 * block to handle any errors that may occur.
 *
 * @param {string} address - An input to be checked for validity.
 *
 * @returns {boolean} True if the provided address is valid according to the Bech32
 * encoding standard and false otherwise.
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
 * @description Determines and returns the type of a given address, which can be a
 * string or an object of types `Address` or `StakeAddress`. It handles different
 * scenarios to ensure accurate classification and throws errors for invalid inputs.
 *
 * @param {string | Address | StakeAddress} address - Used to determine the address
 * type.
 *
 * @returns {'Base' | 'Pointer' | 'Enterprise' | 'Bootstrap' | 'Stake'} A string
 * literal representing an address type.
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
 * @description Determines whether a given label is equal to either the `REFERENCE_TOKEN_LABEL`
 * or the `USER_TOKEN_LABEL`. If the input label is falsy, it returns false; otherwise,
 * it checks for exact matches and returns true if found.
 *
 * @param {number} label - Checked for specific values.
 *
 * @returns {boolean} True if the input label matches either REFERENCE_TOKEN_LABEL
 * or USER_TOKEN_LABEL, and false otherwise.
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
 * @description Converts a given number into a hexadecimal string format, ensuring
 * it is within the range of 1 to 65535. If the input is out of range, it throws an
 * error. The function also appends a checksum and prefix/suffix characters to the
 * resulting hexadecimal string.
 *
 * @param {number} num - 16-bit unsigned integer.
 *
 * @returns {string} 7 characters long and contains a hexadecimal representation of
 * a number preceded by zeros to ensure a four-digit length, followed by the result
 * of a checksum calculation on this hexadecimal representation, and ending with a zero.
 */
export function toLabel(num: number): string {
  if (num < 0 || num > 65535) {
    throw new Error(`Label ${num} out of range: min label 1 - max label 65535.`);
  }
  const numHex = num.toString(16).padStart(4, '0');
  return '0' + numHex + checksum(numHex) + '0';
}

/**
 * @description Converts a string representing a hexadecimal label into an integer
 * if it meets specific conditions. The label must have a length of 8, with the first
 * and last characters being '0', and its middle section must be a valid hexadecimal
 * number followed by a correct checksum.
 *
 * @param {string} label - 8 characters long.
 *
 * @returns {number | null} 0 if a valid hexadecimal number and checksum match, and
 * null otherwise.
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
 * @description Converts a hexadecimal string to a Uint8Array. It uses the built-in
 * `Buffer` class and its `from` method, specifying the 'hex' encoding. This allows
 * it to take a hexadecimal string as input and return an array of bytes that represent
 * the original data.
 *
 * @param {string} hex - Meant to represent a hexadecimal encoded string.
 *
 * @returns {Uint8Array} A typed array of unsigned 8-bit integers that represents an
 * array of bytes.
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
 * @description Calculates the cyclic redundancy check (CRC) value for a given
 * Uint8Array and an optional previous CRC value, which defaults to 0. It returns the
 * calculated CRC value as a number.
 *
 * @param {Uint8Array} current - Used for calculating the CRC-8 checksum.
 *
 * @param {number} previous - Used to initialize the CRC calculation process.
 *
 * @returns {number} 8-bit cyclic redundancy check (CRC) code calculated for a given
 * input array and an initial CRC value.
 */
export function crc8(current: Uint8Array, previous = 0): number {
  let crc = ~~previous;

  for (let index = 0; index < current.length; index++) {
    crc = TABLE[(crc ^ current[index]) & 0xff] & 0xff;
  }

  return crc;
}

/**
 * @description Converts a Base64-encoded string to a Unicode string by first decoding
 * the Base64 string using `atob`, then splitting each character into its hexadecimal
 * representation with `charCodeAt` and `toString(16)`, and finally joining the
 * resulting strings together with `URIComponent`.
 *
 * @param {string} str - Expected to be a base64 encoded string.
 *
 * @returns {string} A URL-encoded representation of the input base64 string decoded
 * to its original Unicode characters.
 */
export const base64ToUnicode = (str: string) => {
  return decodeURIComponent(
    atob(str)
      .split('')
      .map((c) => {
        // Converts Unicode characters to hexadecimal escape sequences.

        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(''),
  );
};
/**
 * @description Converts a hexadecimal string to an ASCII string. It iterates over
 * the input hexadecimal string in steps of two characters, parses each pair as a
 * 16-bit integer, and appends the corresponding ASCII character to the output string.
 *
 * @param {string} str1 - Hexadecimal string to be converted into ASCII.
 *
 * @returns {string} A representation of the original hexadecimal input converted to
 * ASCII characters.
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
 * the input string using URL encoding, then replaces any escaped Unicode characters
 * with their corresponding ASCII values, and finally applies Base64 encoding.
 *
 * @param {string} str - Required input data to be converted.
 *
 * @returns {string} A base64-encoded representation of the original input string,
 * but with Unicode characters replaced by their corresponding byte values in the
 * UTF-16 encoding scheme.
 */
export function unicodeToBase64(str: string) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function toSolidBytes(match, p1) {
      // Converts hexadecimal byte sequences to characters.

      return String.fromCharCode(Number('0x' + p1));
    }),
  );
}
/**
 * @description Converts a given Data URI string to a plain text string, handling
 * both base64-encoded and UTF-8 encoded data. It attempts to decode the encoded data
 * using either Unicode or URL decoding methods, depending on the format specified
 * in the URI.
 *
 * @param {string} dataURI - Data in Uniform Resource Identifier format.
 *
 * @returns {string} A representation of the binary data encoded as a URI.
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
 * over each character, getting its Unicode code point using `charCodeAt`, converting
 * it to a hexadecimal string using `toString(16)`, and then joining the resulting
 * array of hexadecimal strings into a single string.
 *
 * @param {string} str - Intended to be converted into hexadecimal format.
 *
 * @returns {string} A hexadecimal representation of the input ASCII characters. The
 * returned string consists of concatenated hexadecimal codes of individual ASCII
 * characters in the input string.
 */
export function asciiToHex(str: string) {
  const arr1 = [];
  for (let n = 0, l = str.length; n < l; n++) {
    const hex = Number(str.charCodeAt(n)).toString(16);
    arr1.push(hex);
  }
  return arr1.join('');
}
