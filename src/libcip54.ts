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
 * @description Initializes various variables and sets their values based on input
 * parameters, including network ID, PostgreSQL client connection, IPFS gateway,
 * Arweave gateway, Redis client, and timeouts. The function is likely used to set
 * up an application or service with these dependencies.
 *
 * @param {'mainnet' | 'testnet'} networkId - Used to specify whether it's a mainnet
 * or testnet connection.
 *
 * @param {pgCon.Client} connection - Used to establish a PostgreSQL connection.
 *
 * @param {string | null} ipfsGateway - Used to set an IPFS gateway.
 *
 * @param {string | null} arweaveGateway - Intended to be used as an Arweave gateway.
 *
 * @param {RedisClientType | null} redis - Used to store data temporarily.
 *
 * @param {string} redisPrefix - Used to prefix keys in Redis.
 *
 * @param {number} redisTTL - Related to Redis data storage duration.
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
 * @description Asynchronously retrieves data from a specified URL using the Axios
 * library. It allows for optional configuration and sets a timeout value and an abort
 * signal based on the `_getTimeout` variable before making the GET request.
 *
 * @param {string} url - The target URL to send the request to.
 *
 * @returns {Promise<AxiosResponse>} A promise that resolves to an AxiosResponse object.
 */
const axiosGet = async (url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> => {
  return await axios.get(url, { ...config, timeout: _getTimeout, signal: AbortSignal.timeout(_getTimeout) });
};

/**
 * @description Checks whether `_pgClient` and `_networkId` are defined. If either
 * is undefined, it throws an error with a specific message, indicating that
 * initialization has not been performed before attempting to use the variables.
 */
const ensureInit = () => {
  if (!_pgClient || !_networkId) throw new Error('Libcip54 error - please initialize before use');
};

/**
 * @description Returns a value stored in `_getTimeout`. It does not perform any
 * computation or processing; it simply retrieves and exports the current value of `_getTimeout`.
 *
 * @returns {number} `_getTimeout`.
 */
export const queryGetTimeout = (): number => {
  return _getTimeout;
};

/**
 * @description Sets a timeout value for subsequent calls to `_getTimeout`, which
 * defaults to 2000 milliseconds if no argument is provided. The set value can be
 * retrieved by other parts of the code through the `_getTimeout` variable.
 *
 * @param {number} ms - Used to set the timeout.
 */
export const setGetTimeout = (ms: number = 2000) => {
  _getTimeout = ms;
};

/**
 * @description Retrieves a value from Redis cache with a given name, checks for its
 * existence and validity, and returns it as a parsed JSON object if found, otherwise
 * returns null. It also checks for a valid `_redis` object before attempting to
 * access the cache.
 *
 * @param {string} name - Used to identify a specific cached item.
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
 * @description Sets a cache with Redis, storing the provided data under the given
 * name for a specified time-to-live (TTL) duration or defaulting to a configured TTL
 * if none is supplied.
 *
 * @param {string} name - Used to identify cache entries.
 *
 * @param {any} data - Intended to be cached with the given name.
 */
const doCache = async (name: string, data: any, ttl?: number) => {
  if (!_redis) return;
  await _redis.setEx(_redisPrefix + ':' + name, ttl ? ttl : _redisTTL, JSON.stringify(data));
};

/**
 * @description Retrieves JSON data from a given URL while caching it using Redis for
 * faster subsequent requests. If Redis is available, it checks for cached results;
 * otherwise, it fetches the data and caches it.
 *
 * @param {string} url - The URL to fetch JSON data from.
 *
 * @returns {object} Parsed JSON from a URL, either fetched fresh from the URL or
 * retrieved from a cache.
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
 * @description Retrieves a blob from a URL, caching it if Redis is available and
 * checking for cache hits before making a network request. It returns the blob object
 * if a cached version exists or fetches the blob if not.
 *
 * @param {string} url - Used to fetch a blob from the specified URL.
 *
 * @returns {Blob} A binary data that can be used to create an image, video, audio
 * file etc.
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
 * @description Fetches a list of transactions from multiple stake addresses and
 * returns them as an object, where each key is a stake address and its corresponding
 * value is an array of transactions associated with that address.
 *
 * @param {{ transactions: string[] | string }} featureTree - Used to specify
 * transactions to retrieve.
 *
 * @param {string} walletAddr - Used to identify a wallet address.
 *
 * @returns {Promise<object>} A JSON object where keys are stake addresses and values
 * are arrays of transaction objects. The returned object may be empty if no transactions
 * were found for any stake address.
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
 * @description Retrieves a list of transactions from a specified stake address, with
 * pagination support. It returns a JSON array of transactions, including details
 * such as hash, outputs, and inputs. The function also caches the results for
 * subsequent requests with the same parameters.
 *
 * @param {string} stakeAddress - The address of the stake to retrieve transactions
 * for.
 *
 * @param {number} page - Used for pagination.
 *
 * @returns {Promise<any>} An array of transactions from a stake address, containing
 * various properties such as hash, out_sum, fee, size, block information and outputs
 * and inputs data in JSON format.
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
 * @description Retrieves a handle associated with a given wallet address from a
 * PostgreSQL database, using caching for performance optimization. It returns an
 * object or null if no handle is found.
 *
 * @param {string} walletAddr - Required. It represents a wallet address to query for
 * an Ada handle.
 *
 * @returns {Promise<object | null>} Either an object containing the Ada handle or
 * null if it cannot be determined.
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
 * @description Retrieves tokens from a feature tree and returns them as an object.
 * It takes a feature tree with token information and a wallet address, then iterates
 * through the tokens, resolving stake addresses and fetching assets from each stake
 * using the `getTokensFromStake` function.
 *
 * @param {{ tokens: string[] | string }} featureTree - Used to hold an array or a
 * single token name.
 *
 * @param {string} walletAddr - Used as the stake address for own tokens.
 *
 * @returns {Promise<object>} An object containing stake addresses as keys and their
 * corresponding assets as values.
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
 * @description Retrieves tokens from a given address or stake address and returns
 * an array of token information. It takes an optional `page` parameter for pagination.
 * If the input address is invalid, it attempts to retrieve the stake address using
 * `getStakeFromAny`.
 *
 * @param {string} address - Required for processing tokens.
 *
 * @param {number} page - Used to specify pagination.
 *
 * @returns {Promise<{ unit: string; quantity: number }[] | null>} An array of objects
 * containing 'unit' and 'quantity' properties, or null if no result is found.
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
 * @description Asynchronously retrieves a list of tokens associated with a given
 * stake address from a PostgreSQL database. It supports filtering by policies and
 * caches the results to improve performance.
 *
 * @param {string} stakeAddress - Used to specify an address related to staking.
 *
 * @param {number} page - Used to specify a specific page of data to retrieve.
 *
 * @param {boolean} policies - Used to group tokens by policy.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing a "unit" property with a hexadecimal-encoded string and a "quantity"
 * property with a numeric value.
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
 * @description Retrieves unique policies from a stake address and returns them as
 * an array of objects containing unit and quantity data. It is an asynchronous
 * function that wraps another function, `getTokensFromStake`, to retrieve the policies.
 *
 * @param {string} stakeAddress - Used to identify a stake.
 *
 * @param {number} page - Used to specify pagination.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects that
 * contain two properties: "unit" and "quantity", representing unique policies from
 * a stake.
 */
export async function getUniquePoliciesFromStake(
  stakeAddress: string,
  page: number = 0,
): Promise<{ unit: string; quantity: number }[]> {
  return await getTokensFromStake(stakeAddress, page, true);
}

/**
 * @description Retrieves a list of tokens from a specified policy, caching the result
 * for future requests with the same parameters. It queries the database to retrieve
 * token information and returns the results as a promise.
 *
 * @param {string} policyId - Used to filter tokens by policy.
 *
 * @param {number} page - Used to specify the page number for pagination.
 *
 * @returns {Promise<any>} Resolved with an array-like object containing the tokens
 * matching the policy ID and page number, with each element being an object having
 * two properties: "unit" and "quantity".
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
 * @description Retrieves a list of policy holders for a given policy or array of
 * policies, along with their total quantity and stake address, from a PostgreSQL
 * database, while also implementing caching to improve performance.
 *
 * @param {string | string[]} policyId - Used to filter policy holders by specific policies.
 *
 * @param {number} page - Used to specify the page of policy holders to retrieve.
 *
 * @returns {Promise<any>} Resolved to an array of objects. Each object represents a
 * policy holder and contains two properties: "quantity" and "stake". The "quantity"
 * property holds the sum of transaction output quantities for each stake address,
 * and the "stake" property holds the corresponding stake addresses.
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
 * @description Retrieves the token holders for a given unit and page number from a
 * PostgreSQL database using an async query. It caches the result to avoid repeated
 * queries and returns the token holders' addresses, staking amounts, and total
 * quantities sorted by staking amount in descending order.
 *
 * @param {string} unit - Used to identify the multi-asset unit being queried.
 *
 * @param {number} page - Used for pagination.
 *
 * @returns {Promise<any>} A list of token holders' information, including their
 * addresses, stake amounts, and total quantities.
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
 * @description Retrieves UTXOs (Unspent Transaction Outputs) from a feature tree and
 * returns them as an object, with each stake address mapped to its corresponding
 * UTXOs. If a stake address is set to 'own', it is replaced with the provided wallet
 * address.
 *
 * @param {{ utxos: string[] | string }} featureTree - Used to specify UTXO(s) for processing.
 *
 * @param {string} walletAddr - Used to determine stake address for some UTXO cases.
 *
 * @returns {Promise<any>} An object where each key is a stake address and its
 * corresponding value is an array of UTXO responses.
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
 * @description Retrieves a list of unspent transaction outputs (UTXOs) associated
 * with a specified stake address from a PostgreSQL database using the `getUTXOsFromEither`
 * function, allowing for pagination by page number.
 *
 * @param {string} stakeAddress - Required for fetching UTXOs related to a stake address.
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
 * >} An array of objects containing information about unspent transaction outputs.
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
 * @description Retrieves Unspent Transaction Outputs (UTXOs) associated with a given
 * Bitcoin address. It takes an optional `page` parameter for pagination and returns
 * an array of UTXO objects, including details such as transaction hash, index, value,
 * and multiasset information.
 *
 * @param {string} baseAddress - Required for fetching unspent transaction outputs (UTXOs).
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
 * >} An array of objects, each representing a UTXO (Unspent Transaction Output) with
 * six properties.
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
 * a stake address or a base address, with optional pagination and caching. It returns
 * an array of objects containing UTXO details, such as the transaction hash, index,
 * value, and metadata.
 *
 * @param {string | null} stakeAddress - Used for filtering UTXOs by stake address.
 *
 * @param {string | null} baseAddress - Optional, used to filter UTXO results by address.
 *
 * @param {number} page - Used to specify a specific page of UTXO data.
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
 * >} An array of objects.
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
 * @description Fetches information about libraries from an API and their corresponding
 * files, filters out unnecessary files, and returns a promise with arrays of JavaScript
 * library sources and CSS stylesheets.
 *
 * @param {{
 *   libraries: { name: string; version: string }[];
 * }} featureTree - Used to represent a tree-like data structure containing library
 * information.
 *
 * @returns {Promise<{ libraries: string[]; css: string[] }>} A promise that resolves
 * to an object containing two properties: "libraries" and "css", each being an array
 * of strings.
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
 * @description Retrieves metadata for a given unit. It first extracts label and other
 * information from the unit. If the label does not conform to CIP68, it attempts to
 * retrieve metadata from mint transaction; otherwise, it calls another function to
 * get CIP68 metadata.
 *
 * @param {string} unit - Required for fetching metadata.
 *
 * @returns {Promise<any>} Either null or an object representing the metadata for a
 * specific unit, depending on the type and contents of the input unit.
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
 * @description Retrieves data from a PostgreSQL database to obtain the hash and
 * metadata for a specific mint transaction unit. It first checks cache, then queries
 * the database if necessary, and finally caches the result for future use.
 *
 * @param {string} unit - 56 characters long.
 *
 * @returns {Promise<{ txHash: string; metadata: { key: string; json: object }[] } |
 * null>} Either a promise that resolves to an object with two properties: 'txHash'
 * and 'metadata', or null.
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
 * a query that joins multiple tables, parses CBOR-encoded data, and caches the result
 * to improve performance. It returns the parsed metadata or null if no matching
 * record is found.
 *
 * @param {string} unit - 64 characters long, used as a filter for retrieving metadata.
 *
 * @returns {Promise<any>} A metadata object containing key-value pairs parsed from
 * CBOR data. The return value may be null, an array, or a boolean depending on the
 * outcome of the query and parsing operations.
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
     * @description Takes a list of any type as input, recursively converts its items
     * into their corresponding JSON values (map, bytes, or lists), and returns the
     * resulting list of converted values.
     *
     * @param {any} list - Intended to be a list of CBOR objects.
     *
     * @returns {any} An array containing parsed values from a list of CBOR JSON objects.
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
     * @description Transforms a CBOR map into a JSON object. It iterates over each field
     * in the map, converts CBOR values (bytes, lists, or maps) to their respective JSON
     * equivalents, and assigns them to keys converted from CBOR bytes to strings.
     *
     * @param {any} map - Expected to be an object containing CBOR (Concise Binary Object
     * Representation) encoded JSON data.
     *
     * @returns {any} An object that represents a JSON map parsed from CBOR input. The
     * returned object has key-value pairs where keys are strings and values can be either
     * strings, lists or maps.
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
 * @description Retrieves a list of files with their corresponding metadata for a
 * given unit, and returns an array of objects containing file source, media type,
 * and additional properties. The function also handles cases where files belong to
 * different units.
 *
 * @param {string} unit - Used to specify the unit for which files are being retrieved.
 *
 * @returns {Promise<{ src: string; mediaType: string }[]>} A promise that resolves
 * to an array of objects each containing a source URL and a media type.
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
 * @description Takes a blob as input, converts it to an array buffer, then to a
 * Uint8Array, decodes it into a string using TextDecoder, and returns a URL-encoded
 * data URI with the blob's type and decoded data.
 *
 * @param {Blob} blob - Required to generate a URL-encoded data URL from a blob.
 *
 * @returns {string} A data URL representing the specified Blob, formatted as a Uniform
 * Resource Locator (URL).
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
 * @description Converts a given Blob object into a data URL, which can be used to
 * represent the blob as a string. It accomplishes this by first converting the blob
 * to an array buffer, extracting the MIME type, and then encoding the buffer contents
 * in base64.
 *
 * @param {Blob} blob - Expected to contain binary data.
 *
 * @returns {Promise<string>} A data URL that represents the provided blob. The data
 * URL starts with "data:" and includes information about the MIME type and base64-encoded
 * binary data of the blob.
 */
export const getDataURLFromBlob = async (blob: Blob): Promise<string> => {
  const arrayBuf = await blob.arrayBuffer();
  const mType = blob.type.split(';')[0];
  return 'data:' + mType + ';base64,' + Buffer.from(arrayBuf).toString('base64'); // Currently not using the function above because I have no prob
};
/**
 * @description Iterates over an array of file objects or strings, retrieves files
 * based on their type and metadata, and aggregates them into a hierarchical structure
 * based on their unit and media type. It also handles errors and limits the number
 * of files downloaded.
 *
 * @param {string} unit - Used to categorize files.
 *
 * @param {({ src?: string; mediaType?: string; id?: string | number } | string)[]}
 * files - An array of file objects or strings.
 *
 * @param {any} metadata - Used to store additional file information.
 *
 * @returns {Promise<any>} An object with properties representing units and their
 * respective values being arrays of objects that contain file metadata.
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
 * @description Retrieves a file from various sources (IPFS, ARWEAVE, HTTP/HTTPS,
 * data:, cnft:) and returns its buffer, media type, unit, id, and props as an object.
 * It handles different types of URLs and file formats.
 *
 * @param {string} src - Referred to as the source URL.
 *
 * @param {string} mediaType - Used to specify the media type of the file being fetched.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; id?: string | number; unit?:
 * string; props?: any }>} An object containing a buffer representing the file data,
 * its MIME type, and optional ID, unit, and properties.
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
 * @description Retrieves a file from metadata based on the provided `unit`, `id`,
 * and optional `metadata`. It attempts to find the file by filtering through available
 * files or uses, and returns the file's buffer, media type, and properties if found,
 * or throws an error if not.
 *
 * @param {string} unit - Used to identify the source of metadata.
 *
 * @param {string | number | null} id - Used to identify a file.
 *
 * @param {any | null} metadata - Optional.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; props?: any; unit?: string;
 * id?: string; src?: string }>} A promise that resolves to an object containing a
 * file's properties and buffer, with optional properties for the unit, ID, and source.
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
 * with their corresponding quantities, from a PostgreSQL database or an alternative
 * data source (Blockfrost API). It implements caching to optimize repeated requests
 * and handles pagination for large result sets.
 *
 * @param {string} unit - Used to filter addresses by unit or asset name.
 *
 * @param {number} count - Used to limit the number of results.
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
 * @description Aggregates various data from a given `featureTree`, including libraries,
 * tokens, UTXOs, transactions, and files. It fetches these data asynchronously using
 * separate functions, populates an object with the results, and returns it.
 *
 * @param {{
 *     libraries: { name: string; version: string }[];
 *     tokens: string[] | string;
 *     utxos: string[] | string;
 *     transactions: string[] | string;
 *     mintTx?: boolean;
 *     files?: boolean | string | ({ src?: string; mediaType?: string } | string)[];
 *   }} featureTree - Used to determine the data to be fetched and processed.
 *
 * @param {any} metadata - Unused, implying that it may be removed or replaced later.
 *
 * @param {string} walletAddr - Used to specify the owner's wallet address.
 *
 * @param {string} tokenUnit - Used to store token unit metadata.
 *
 * @returns {object} An aggregation of various data such as libraries, CSS stylesheets,
 * tokens, UTXOs, transactions, owner address, fetched date, token unit, and libcip54
 * version.
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
 * @description Converts a base address into a stake address. It first checks if the
 * base address is valid and if it's not, it creates a new stake address from the
 * payment credentials hash. The function returns the stake address as a string in lowercase.
 *
 * @param {string} baseAddress - Required for processing stake information.
 *
 * @returns {string | null} Either a lowercase string representation of an instance
 * of StakeAddress or null if certain conditions are met.
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
 * @description Retrieves the stake associated with a given address and returns it
 * as a lowercase string, or null if no stake is found.
 *
 * @param {string} address - An input value to be processed.
 *
 * @returns {string | null} Either a lowercase string representation of an address
 * stake or null if no valid address stake was found.
 */
export function getStakeFromAny(address: string): string | null {
  // Todo - make this support address being a CSL address object
  const Addr = getStake(address);
  if (!Addr) return null;
  return Addr.toString().toLowerCase();
}

/**
 * @description Generates a base address for a payment and stake pair, taking into
 * account whether the network is mainnet or testnet. It returns the generated address
 * as a lowercase string.
 *
 * @param {string} payment - 28 bytes long.
 *
 * @param {string} stake - Used to create stake credentials.
 *
 * @returns {string} The lowercase representation of a cryptocurrency address,
 * constructed from network ID, payment key hash, stake key hash and other parameters.
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

/*
export function validAddress(address: string) {
  try {
    return CSL.Address.from_bech32(address);
  } catch (e) {}

  try {
    return CSL.Address.from_hex(address);
  } catch (e) {}

  return;
}
//*/

/**
 * @description Attempts to validate a provided address, first as a string and then
 * as bytes, using multiple types of address objects (`Address` and `StakeAddress`).
 * If no valid address is found, it throws an error with the invalid address.
 *
 * @param {string | byte[]} address - Intended for validation.
 *
 * @returns {StakeAddress | Address} Either a valid StakeAddress object or a valid
 * Address object. If no valid address can be created from the input data, an error
 * is thrown.
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

/*
export function validBech32Address(address: string) {
  try {
    return CSL.Address.from_bech32(address);
  } catch (e) {}
  return;
}
//*/
/**
 * @description Checks whether a given string represents a valid Bech32-encoded address
 * and returns it as either a `StakeAddress` or an `Address`. If not, it throws an
 * error with the message "Invalid bech32 address".
 *
 * @param {string} address - A bech32 address to verify.
 *
 * @returns {StakeAddress | Address} A union type representing either a StakeAddress
 * or an Address.
 */
export function validBech32Address(address: string): StakeAddress | Address {
  if (!isBech32(address)) throw new Error('Invalid bech32 address');
  return validAddress(address);
}

/**
 * @description Determines the type of a given `address`, which can be a string or
 * an instance of `Address` or `StakeAddress`. It returns one of five types: 'Base',
 * 'Pointer', 'Enterprise', 'Bootstrap', or 'Stake'.
 *
 * @param {string | Address | StakeAddress} address - Used to determine address type.
 *
 * @returns {'Base' | 'Pointer' | 'Enterprise' | 'Bootstrap' | 'Stake'} A string
 * representing the type of the provided address.
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
 * @description Determines whether a given label is either the reference token label
 * or the user token label, and returns a boolean value indicating this equivalence.
 * If no label is provided, it returns false.
 *
 * @param {number} label - Required for comparison.
 *
 * @returns {boolean} True if the input label matches either `REFERENCE_TOKEN_LABEL`
 * or `USER_TOKEN_LABEL`, and false otherwise.
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
 * @description Converts a given integer number to a hexadecimal string representation
 * for use as a label, ensuring it is within the valid range (1-65535). It also
 * calculates and appends a checksum value before returning the resulting string.
 *
 * @param {number} num - 16-bit integer representing a label.
 *
 * @returns {string} 7-character long and consists of two parts: a prefix '0', followed
 * by a hexadecimal representation of the input number padded with leading zeros to
 * a length of 4 characters, then a checksum calculated from the hexadecimal
 * representation, and finally a trailing '0'.
 */
export function toLabel(num: number): string {
  if (num < 0 || num > 65535) {
    throw new Error(`Label ${num} out of range: min label 1 - max label 65535.`);
  }
  const numHex = num.toString(16).padStart(4, '0');
  return '0' + numHex + checksum(numHex) + '0';
}

/**
 * @description Converts a given string label into a hexadecimal number. It first
 * checks if the label meets specific conditions (8 characters, starts and ends with
 * '0', and has correct checksum). If valid, it extracts the hex number and calculates
 * its checksum, returning the result if they match.
 *
 * @param {string} label - 8 characters long, representing a hexadecimal label.
 *
 * @returns {number | null} Either a hexadecimal number if the input label corresponds
 * to it according to the given conditions, or null otherwise.
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
 * @description Converts a hexadecimal string to a Uint8Array. It takes a string input
 * in hexadecimal format and returns an array of unsigned integers between 0 and 255,
 * representing the binary data corresponding to the input string.
 *
 * @param {string} hex - Expected to contain a hexadecimal value.
 *
 * @returns {Uint8Array} An array of 8-bit unsigned integers that can be used to
 * represent binary data such as hexadecimal encoded strings.
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
 * @description Calculates a cyclic redundancy check (CRC) value for an input
 * `Uint8Array` using the provided `previous` value as initial CRC. The calculation
 * involves XORing each byte with the current CRC, indexing into a predefined table
 * to get the next CRC value, and returning the result.
 *
 * @param {Uint8Array} current - Used to calculate the CRC-8 checksum.
 *
 * @param {number} previous - Used as an initial value for the CRC calculation.
 *
 * @returns {number} 8-bit cyclic redundancy check (CRC) calculated from the provided
 * data.
 */
export function crc8(current: Uint8Array, previous = 0): number {
  let crc = ~~previous;

  for (let index = 0; index < current.length; index++) {
    crc = TABLE[(crc ^ current[index]) & 0xff] & 0xff;
  }

  return crc;
}

/**
 * @description Converts a Base64-encoded string to its corresponding Unicode string
 * representation by decoding the Base64 string, mapping each character code to its
 * hexadecimal representation with leading zeros, and then reassembling the resulting
 * strings with percentage signs as separators.
 *
 * @param {string} str - Expected to be a base64 encoded string.
 *
 * @returns {string} A decoded and URL-encoded representation of the base64-encoded
 * input string.
 */
export const base64ToUnicode = (str: string) => {
  return decodeURIComponent(
    atob(str)
      .split('')
      .map((c) => {
        // Converts ASCII character to URL encoded hexadecimal string.

        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(''),
  );
};
/**
 * @description Converts a hexadecimal string to an ASCII string by iterating over
 * the input hexadecimal string two characters at a time, parsing each pair as a hex
 * value, and then converting it to its corresponding ASCII character using the
 * `String.fromCharCode` method.
 *
 * @param {string} str1 - Expected to hold a hexadecimal string.
 *
 * @returns {string} ASCII representation of a hexadecimal input.
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
 * @description Converts a Unicode string to Base64 format by first encoding it with
 * UTF-8 and then replacing any escaped characters with their corresponding Unicode
 * code points before encoding them into Base64 using the `btoa` function.
 *
 * @param {string} str - Intended to be a Unicode string.
 *
 * @returns {string} Base64-encoded representation of a Unicode string.
 */
export function unicodeToBase64(str: string) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function toSolidBytes(match, p1) {
      // Converts hex-encoded bytes to characters.

      return String.fromCharCode(Number('0x' + p1));
    }),
  );
}
/**
 * @description Converts a Data URI string into its corresponding binary data or text
 * string, depending on whether it is encoded using Base64 or UTF-8. It handles both
 * cases and returns the decoded byte string.
 *
 * @param {string} dataURI - Expected to be a data URI string.
 *
 * @returns {string} The decoded binary data from a Data URI representation.
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
 * @description Converts a given string into its corresponding hexadecimal representation
 * by iterating through each character, extracting the ASCII value using `charCodeAt`,
 * and then converting it to a hexadecimal string using `toString(16)`. The resulting
 * array of hex strings is joined into a single string.
 *
 * @param {string} str - Required for conversion to hexadecimal.
 *
 * @returns {string} A sequence of hexadecimal characters representing the ASCII code
 * points of the input string.
 */
export function asciiToHex(str: string) {
  const arr1 = [];
  for (let n = 0, l = str.length; n < l; n++) {
    const hex = Number(str.charCodeAt(n)).toString(16);
    arr1.push(hex);
  }
  return arr1.join('');
}
