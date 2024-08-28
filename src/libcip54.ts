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
 * @description Initializes various variables for a CIP-54-based application, including
 * network ID, PostgreSQL client connection, IPFS and Arweave gateways, Redis client,
 * prefix, TTL, and get timeout. It sets default values for optional parameters and
 * assigns them to internal variables.
 *
 * @param {'mainnet' | 'testnet'} networkId - Used to determine the network connection.
 *
 * @param {pgCon.Client} connection - Used to establish a PostgreSQL connection.
 *
 * @param {string | null} ipfsGateway - Used to specify an IPFS gateway.
 *
 * @param {string | null} arweaveGateway - Used to specify the Arweave gateway.
 *
 * @param {RedisClientType | null} redis - Used to set up Redis connection settings.
 *
 * @param {string} redisPrefix - Used to set a prefix for Redis keys.
 *
 * @param {number} redisTTL - Used to set the time-to-live for cached data in Redis.
 *
 * @param {number} getTimeout - Used for setting timeout duration.
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
 * @description Makes a GET request to a specified URL using Axios library and returns
 * a promise that resolves to an Axios response. The function also sets a timeout and
 * signal for the request, which can be overridden by providing a custom configuration
 * object.
 *
 * @param {string} url - The URL to make a GET request to.
 *
 * @returns {Promise<AxiosResponse>} A promise that resolves to an AxiosResponse
 * object, containing information about the HTTP response from the server.
 */
const axiosGet = async (url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> => {
  return await axios.get(url, { ...config, timeout: _getTimeout, signal: AbortSignal.timeout(_getTimeout) });
};

/**
 * @description Checks whether `_pgClient` and `_networkId` variables are defined,
 * throwing an error if they are not. This ensures that these essential variables
 * have been initialized before any subsequent code attempts to use them.
 */
const ensureInit = () => {
  if (!_pgClient || !_networkId) throw new Error('Libcip54 error - please initialize before use');
};

/**
 * @description Returns a value representing a timeout period for queries, obtained
 * from an external variable `_getTimeout`. The returned value is a number indicating
 * the time in milliseconds after which a query will be considered timed out and
 * potentially cancelled or retried.
 *
 * @returns {number} `_getTimeout`.
 */
export const queryGetTimeout = (): number => {
  return _getTimeout;
};

/**
 * @description Sets a timeout value, represented by `ms`, to the `_getTimeout`
 * variable. If no `ms` value is provided, it defaults to 2000 milliseconds. This
 * function does not return any value and modifies the internal state of the program.
 *
 * @param {number} ms - Used to set a timeout.
 */
export const setGetTimeout = (ms: number = 2000) => {
  _getTimeout = ms;
};

/**
 * @description Retrieves a cached value for a given name from Redis. If the cache
 * is empty or undefined, it returns null. Otherwise, it parses the cached JSON and
 * returns the result. The function also checks if Redis client instance `_redis`
 * exists before attempting to get the cache.
 *
 * @param {string} name - Used to identify a specific cache item.
 *
 * @returns {object} Parsed from a JSON string retrieved from Redis. If no cache
 * exists for the given name or if an error occurs during parsing, the function returns
 * null.
 */
const checkCache = async (name: string) => {
  if (!_redis) return null;
  let cache: any = await _redis.get(_redisPrefix + ':' + name);
  if (!cache) return null;
  cache = JSON.parse(cache);
  return cache;
};

/**
 * @description Sets a value in Redis with a given name and optional TTL (time to
 * live). If Redis is not available or if no TTL is provided, it does nothing. The
 * value is set as a JSON string using the provided data.
 *
 * @param {string} name - Used to identify cached data.
 *
 * @param {any} data - Cached in Redis.
 */
const doCache = async (name: string, data: any, ttl?: number) => {
  if (!_redis) return;
  await _redis.setEx(_redisPrefix + ':' + name, ttl ? ttl : _redisTTL, JSON.stringify(data));
};

/**
 * @description Retrieves JSON data from a URL while handling cache and Redis storage.
 * If Redis is available, it first checks for cached results; if not, it fetches the
 * data, caches it, and returns the result. Otherwise, it falls back to a regular
 * fetch and caching mechanism.
 *
 * @param {string} url - The URL to fetch JSON data from.
 *
 * @returns {object} The JSON response from the specified URL. If cached, it returns
 * the cached result; otherwise, it retrieves and caches the JSON response.
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
 * @description Retrieves a blob from a specified URL. It first checks if a cache is
 * available; if so, it attempts to retrieve the cached blob. If not, it fetches the
 * blob from the URL and caches it for future use.
 *
 * @param {string} url - URL to fetch and cache as a blob.
 *
 * @returns {Blob} A binary data blob.
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
 * @description Retrieves a collection of transactions for a given wallet address or
 * stake addresses from a feature tree, and organizes them into an object with stake
 * addresses as keys and transaction lists as values.
 *
 * @param {{ transactions: string[] | string }} featureTree - Used to specify an array
 * or string of transaction IDs.
 *
 * @param {string} walletAddr - Used to identify the wallet address for retrieving transactions.
 *
 * @returns {Promise<object>} An object containing a collection of transactions for
 * each stake address found in the input transactions array. The object's properties
 * are the stake addresses as keys and arrays of transactions as values.
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
 * @description Retrieves transactions associated with a specified stake address from
 * a Postgres database, caching the result to avoid repeated queries. It returns up
 * to 20 transactions per page, sorted by transaction ID in descending order, and
 * includes details such as hash, outputs, and inputs.
 *
 * @param {string} stakeAddress - Used to filter transactions by stake address.
 *
 * @param {number} page - Used to specify the page number for pagination.
 *
 * @returns {Promise<any>} An array of objects containing transaction data from a
 * specific stake address. Each object represents a single transaction and includes
 * various details such as hash, out_sum, fee, deposit, size, block information and
 * outputs and inputs in JSON format.
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
 * @description Retrieves a handle from the PostgreSQL database for a given wallet
 * address. It checks the cache first and then queries the database using a SQL query
 * to find the handle. If found, it converts the handle from hex to ASCII and caches
 * it for future use.
 *
 * @param {string} walletAddr - Used to represent a wallet address.
 *
 * @param {boolean} cacheFail - Used to control caching behavior when query fails.
 *
 * @returns {Promise<object | null>} Either an object containing the handle of a
 * multi-asset or null if no handle found or if cache fail flag is set to false.
 */
export async function getAdaHandleFromAddress(walletAddr: string, cacheFail: boolean = false): Promise<object | null> {
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
    if (cacheFail) {
      await doCache('getAdaHandleFromAddress:' + stake, '');
    }
    return null;
  }
}

/**
 * @description Retrieves tokens from a feature tree and returns them as an object,
 * where each stake address is mapped to its corresponding tokens. It handles both
 * single token and array inputs, and fetches token information from the given wallet
 * address or stake addresses.
 *
 * @param {{ tokens: string[] | string }} featureTree - Used to specify a list of
 * token addresses or a single address.
 *
 * @param {string} walletAddr - Used to identify the wallet address.
 *
 * @returns {Promise<object>} An object that maps stake addresses to their corresponding
 * assets. The returned object contains key-value pairs where keys are stake addresses
 * and values are arrays of tokens associated with those stakes.
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
 * @description Retrieves a list of tokens from a given address or its corresponding
 * stake address. If no stake address is found, it returns null. It takes an optional
 * page number parameter and returns a promise containing an array of token objects
 * or null if no result is found.
 *
 * @param {string} address - Required for retrieving tokens.
 *
 * @param {number} page - Used to specify a page number for retrieving tokens.
 *
 * @returns {Promise<{ unit: string; quantity: number }[] | null>} Either an array
 * of objects containing "unit" and "quantity" properties or null.
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
 * @description Retrieves a list of tokens from a specified stake address and its
 * associated multi-asset transactions, grouping by policy or both policy and name
 * if requested. It also caches results for optimized performance.
 *
 * @param {string} stakeAddress - Used to filter the output based on stake address.
 *
 * @param {number} page - Used to paginate the query results.
 *
 * @param {boolean} policies - Used to filter results by policy or not.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing two properties: "unit" (string) and "quantity" (number).
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
 * @description Retrieves an array of unique policies from a stake address with
 * optional pagination. It calls another function `getTokensFromStake` and filters
 * out duplicate policies before returning them as a promise. The returned data
 * contains unit and quantity information for each policy.
 *
 * @param {string} stakeAddress - Required for identifying a stake address.
 *
 * @param {number} page - Used to specify a page number for pagination purposes.
 *
 * @returns {Promise<{ unit: string; quantity: number }[]>} An array of objects
 * containing a unit and a quantity property.
 */
export async function getUniquePoliciesFromStake(
  stakeAddress: string,
  page: number = 0,
): Promise<{ unit: string; quantity: number }[]> {
  return await getTokensFromStake(stakeAddress, page, true);
}

/**
 * @description Retrieves a list of tokens associated with a given policy ID from a
 * PostgreSQL database. It checks the cache first and if not found, queries the
 * database using a SQL query, then caches the result for future use.
 *
 * @param {string} policyId - Required for querying tokens from a policy.
 *
 * @param {number} page - Used for pagination.
 *
 * @returns {Promise<any>} A promise that resolves to an array of objects containing
 * "unit" and "quantity".
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
 * @description Retrieves policy holders for a given policy or multiple policies,
 * with optional pagination and caching. It queries a PostgreSQL database to fetch
 * stakeholders and their associated quantities, then returns the result in an array.
 *
 * @param {string | string[]} policyId - Used to filter policy holders.
 *
 * @param {number} page - Used for pagination.
 *
 * @returns {Promise<any>} A list of objects containing two properties: 'quantity'
 * and 'stake'. The list represents policy holders with their total quantity and stake
 * information.
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
 * @description Retrieves token holders for a specified `unit`, returning an array
 * of objects containing `address`, `stake`, and `quantity`. It caches results to
 * optimize performance, using PostgreSQL as its database. The function is asynchronous,
 * allowing it to return a promise.
 *
 * @param {string} unit - Used to filter token holders by specific units.
 *
 * @param {number} page - Used to specify the page number for pagination.
 *
 * @returns {Promise<any>} An array of objects containing information about token
 * holders, including address, stake, and quantity. The returned data is paginated,
 * with each page containing a specified number of results.
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
 * @description Retrieves unspent transaction outputs (UTXOs) associated with a given
 * wallet address. It accepts a feature tree containing UTXO strings and a wallet
 * address as inputs, and returns an object mapping stake addresses to their respective
 * UTXOs.
 *
 * @param {{ utxos: string[] | string }} featureTree - An object containing a list
 * of UTXO identifiers.
 *
 * @param {string} walletAddr - Used as a default stake address when 'own' is specified
 * for any utxo.
 *
 * @returns {Promise<any>} An object with properties whose values are arrays of UTXO
 * data, where each property corresponds to a stake address.
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
 * with a specified stake address. It returns an array of objects containing UTXO
 * details, such as txHash, index, address, value, multiasset information, and datum.
 *
 * @param {string} stakeAddress - The address associated with a stake.
 *
 * @param {number} page - Used to paginate UTXO results.
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
 * >} An array of objects containing UTXO information.
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
 * @description Retrieves unspent transaction outputs (UTXOs) associated with a
 * specified base address and optional page number from a database using the `_pgClient`.
 * The function ensures initialization before processing, returning an empty array
 * if not initialized.
 *
 * @param {string} baseAddress - Required for retrieving UTXOs.
 *
 * @param {number} page - Used to specify pagination.
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
 * >} An array of objects representing UTXOs (unspent transaction outputs).
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
 * @description Asynchronously retrieves a list of unspent transaction outputs (UTXOs)
 * from a PostgreSQL database based on either a stake address or a base address. It
 * caches query results for subsequent requests with the same parameters.
 *
 * @param {string | null} stakeAddress - Optional.
 *
 * @param {string | null} baseAddress - Optional, specifying an address to filter
 * UTXOs by.
 *
 * @param {number} page - Used to specify pagination.
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
 * >} An array of objects containing various information about unspent transaction
 * outputs (UTXOs).
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
 * @description Retrieves libraries from a CDN, filters out certain files based on
 * specific conditions, and returns an object containing arrays of JavaScript library
 * sources and CSS file sources.
 *
 * @param {{
 *   libraries: { name: string; version: string }[];
 * }} featureTree - Expected to represent a collection of libraries with their names
 * and versions.
 *
 * @returns {Promise<{ libraries: string[]; css: string[] }>} An object with two
 * properties: `libraries` and `css`, both being arrays of strings representing URLs
 * of library files.
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
 * @description Retrieves the metadata associated with a given unit. It first attempts
 * to fetch the metadata from a mint transaction if the unit is not labeled as CIP68.
 * If it is, it uses the CIP68 metadata retrieval mechanism instead.
 *
 * @param {string} unit - Required for retrieving metadata.
 *
 * @returns {Promise<any>} Either null if no valid data is found or a metadata object
 * that contains information about the unit, policy, and asset name.
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
 * @description Retrieves information about a specific token's mint transaction from
 * a PostgreSQL database. It first checks for cached results, then queries the database
 * using SQL to retrieve the transaction hash and metadata. If no matching result is
 * found, it returns null.
 *
 * @param {string} unit - 64 bytes long.
 *
 * @returns {Promise<{ txHash: string; metadata: { key: string; json: object }[] } |
 * null>} Either an object with a txHash and an array of metadata or null.
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
 * @description Retrieves CIP-68 metadata for a given unit from a PostgreSQL database,
 * parses the retrieved data using CBOR JSON serialization and caching mechanism to
 * store and retrieve results.
 *
 * @param {string} unit - 64 bytes long.
 *
 * @returns {Promise<any>} Either an object (metadata) or null if datum is empty, or
 * false on error or cache miss.
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
     * @description Takes a list of CBOR-encoded JSON objects as input and recursively
     * converts them into a JavaScript array, handling nested maps, bytes, and lists by
     * parsing their respective types and pushing the parsed values into the result array.
     *
     * @param {any} list - Expected to be a list or array of objects.
     *
     * @returns {any} An array containing values parsed from CBOR data. The array elements
     * may be strings, JSON objects, or arrays themselves, depending on the structure of
     * the input data.
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
     * @description Converts a CBOR (Concise Binary Object Representation) map to a JSON
     * object by iterating through its key-value pairs, decoding and recursively processing
     * nested maps and lists, and storing the results in a new JSON object with
     * hexadecimal-encoded keys.
     *
     * @param {any} map - Expected to be a CBOR map data structure.
     *
     * @returns {any} An object that maps hexadecimal strings to values of various types,
     * including strings, lists, and maps.
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
 * @description Retrieves a list of files based on a given unit, optional metadata,
 * and optional actual unit. It fetches file metadata, downloads files, and constructs
 * objects containing file information, including source URL, media type, and additional
 * props.
 *
 * @param {string} unit - Required for fetching files metadata.
 *
 * @returns {Promise<{ src: string; mediaType: string }[]>} A list of objects with
 * properties 'src' and 'mediaType'.
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
 * @description Converts a given blob into a URL-encoded data URI string that can be
 * used as a source for an HTML img element. It takes a Blob object as input and
 * returns a string representation of the encoded data in the form of 'data:mimetype;base64,encoded-data'.
 *
 * @param {Blob} blob - Required for processing data URL encoding.
 *
 * @returns {string} A URL-encoded data URI representing the given blob as a file source.
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
 * @description Converts a given blob into a data URL that can be used to represent
 * the blob as a string. It first retrieves the array buffer from the blob, determines
 * the MIME type, and then combines these with a base64-encoded representation of the
 * array buffer.
 *
 * @param {Blob} blob - Expected to contain binary data.
 *
 * @returns {Promise<string>} A string representing a data URL that can be used to
 * display or process the blob's contents.
 */
export const getDataURLFromBlob = async (blob: Blob): Promise<string> => {
  const arrayBuf = await blob.arrayBuffer();
  const mType = blob.type.split(';')[0];
  return 'data:' + mType + ';base64,' + Buffer.from(arrayBuf).toString('base64'); // Currently not using the function above because I have no prob
};
/**
 * @description Retrieves an array of files from a given list and returns a promise
 * that resolves with an object containing the results. It handles different types
 * of file objects, makes API calls to fetch files, and organizes the results by unit.
 *
 * @param {string} unit - Used to group files together in an object.
 *
 * @param {({ src?: string; mediaType?: string; id?: string | number } | string)[]}
 * files - Used to specify an array of files to get.
 *
 * @param {any} metadata - Used to store additional file data.
 *
 * @returns {Promise<any>} An object with properties that can be either arrays of
 * file objects or error messages. The exact structure depends on the input data and
 * any errors that may occur during processing.
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
 * @description Retrieves a file from various sources (IPFS, Arweave, HTTP, data URLs)
 * and returns a promise containing the file's buffer, media type, ID, unit, and
 * props. It handles different types of URIs and converts them into a standard format.
 *
 * @param {string} src - Intended to be a source URL.
 *
 * @param {string} mediaType - Used to specify the media type of the file being fetched.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; id?: string | number; unit?:
 * string; props?: any }>} A promise that resolves to an object with five properties:
 * buffer (any), mediaType (string), id (optional, string or number), unit (optional,
 * string), and props (optional, any).
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
 * attempts to find the file from the given metadata or token metadata, and if not
 * found, throws an error. The function returns a promise that resolves with a file
 * object containing its buffer, media type, props, unit, ID, and source URL.
 *
 * @param {string} unit - Used to specify the unit context for the file operation.
 *
 * @param {string | number | null} id - Used to identify a specific file or media item.
 *
 * @param {any | null} metadata - Used to filter files by metadata.
 *
 * @returns {Promise<{ buffer: any; mediaType: string; props?: any; unit?: string;
 * id?: string; src?: string }>} A JSON object with various properties including
 * buffer, mediaType, and other metadata.
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
 * @description Retrieves a list of asset addresses associated with a given unit,
 * along with their respective quantities. It also caches the result to avoid repeated
 * database queries and supports pagination for efficient handling of large datasets.
 *
 * @param {string} unit - Used to filter data by blockchain unit, such as asset or contract.
 *
 * @param {number} count - Used to limit the number of addresses returned.
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
 * @description Fetches and aggregates various data from a feature tree object,
 * including libraries, tokens, UTXOs, transactions, and files, and returns a structured
 * object containing the collected data.
 *
 * @param {{
 *     libraries: { name: string; version: string }[];
 *     tokens: string[] | string;
 *     utxos: string[] | string;
 *     transactions: string[] | string;
 *     mintTx?: boolean;
 *     files?: boolean | string | ({ src?: string; mediaType?: string } | string)[];
 *   }} featureTree - Used to fetch libraries, tokens, UTXOs, transactions, and files.
 *
 * @param {any} metadata - Used for storing additional data.
 *
 * @param {string} walletAddr - Used to identify a wallet address.
 *
 * @param {string} tokenUnit - Used to specify the unit of token measurement.
 *
 * @returns {any} An object containing properties for libraries, CSS files, tokens,
 * UTXOs, transactions, owner address, fetched timestamp, token unit, and libcip54 version.
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
 * @description Retrieves the stake credentials for a given base address and returns
 * it as a string. It handles various types of addresses, including StakeKeyHash,
 * StakeValidatorHash, and payment addresses, and converts them to a StakeAddress
 * object before returning its string representation in lowercase.
 *
 * @param {string} baseAddress - Required for processing.
 *
 * @returns {string | null} Either a lower-case string representation of a StakeAddress
 * object or null.
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
 * @description Retrieves and converts a stake address from an input string to
 * lowercase, returning it as a string or null if the retrieval fails.
 *
 * @param {string} address - Used as input to retrieve stake information.
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
 * @description Generates a base address based on a payment and stake string, utilizing
 * network ID (1 for mainnet or other for testnet) and ensuring initialization before
 * processing. It returns the resulting address as a lowercase string.
 *
 * @param {string} payment - 28-character long.
 *
 * @param {string} stake - Used for stake credentials.
 *
 * @returns {string} The lowercase representation of a fully qualified address derived
 * from the given payment and stake information.
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
 * @description Validates a given `address` parameter, which can be either a string
 * or an array of bytes. It attempts to parse the address as a StakeAddress or Address
 * and returns the parsed object if successful; otherwise, it throws an error.
 *
 * @param {string | byte[]} address - Expected to be an address.
 *
 * @returns {StakeAddress | Address} Either a StakeAddress object or an Address object.
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
 * @description Validates whether a given `address` string is valid or not by calling
 * another function `validAddress`. It returns a boolean value indicating whether the
 * address is valid or not, with a default return value of `false` if an error occurs
 * during validation.
 *
 * @param {string} address - An input to be checked for validity.
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
 * @description Validates whether a given string is a Bech32-formatted address. If
 * it is not, it throws an error. Otherwise, it returns the valid address after
 * processing it further. The input must be a Bech32 address for this function to
 * return a result.
 *
 * @param {string} address - A Bech32-encoded address to be validated.
 *
 * @returns {StakeAddress | Address} A union of two types.
 */
export function validBech32Address(address: string): StakeAddress | Address {
  if (!isBech32(address)) throw new Error('Invalid bech32 address');
  return validAddress(address);
}
/**
 * @description Checks whether a given string is a valid Bech32 address. It attempts
 * to execute the `validBech32Address` function, which raises an error if the input
 * is invalid. If no error occurs, it returns true; otherwise, it returns false.
 *
 * @param {string} address - A candidate Bech32 address to be validated.
 *
 * @returns {boolean} True if the given address is a valid Bech32 address and false
 * otherwise.
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
 * @description Determines the type of an input address, which can be a string or an
 * instance of `Address` or `StakeAddress`. It returns one of five types: 'Base',
 * 'Pointer', 'Enterprise', 'Bootstrap', or 'Stake'.
 *
 * @param {string | Address | StakeAddress} address - Used to determine the address
 * type.
 *
 * @returns {'Base' | 'Pointer' | 'Enterprise' | 'Bootstrap' | 'Stake'} A string
 * literal type, indicating one of five possible address types.
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
 * @description Determines whether a given label is either the `REFERENCE_TOKEN_LABEL`
 * or `USER_TOKEN_LABEL`. If the input `label` is falsy, it returns `false`. Otherwise,
 * it checks if the label matches one of the specified values and returns a boolean
 * result accordingly.
 *
 * @param {number} label - Checked for specific values.
 *
 * @returns {boolean} Either `true` if the label matches one of the specified values
 * (`REFERENCE_TOKEN_LABEL` or `USER_TOKEN_LABEL`), or `false` otherwise.
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
 * @description Converts a given integer number into a hexadecimal label string by
 * padding it with zeros, appending the calculated checksum, and prefixing it with
 * zeros. It also validates if the input number is within the range of 1 to 65535.
 *
 * @param {number} num - 16-bit unsigned integer value.
 *
 * @returns {string} 8-character hexadecimal number with a leading zero, followed by
 * a checksum and another leading zero.
 */
export function toLabel(num: number): string {
  if (num < 0 || num > 65535) {
    throw new Error(`Label ${num} out of range: min label 1 - max label 65535.`);
  }
  const numHex = num.toString(16).padStart(4, '0');
  return '0' + numHex + checksum(numHex) + '0';
}

/**
 * @description Converts a string label into an integer number if it matches a specific
 * format and has a valid checksum, otherwise returns null. The format requires the
 * first character to be '0', the last character to be '0', and a length of exactly
 * 8 characters.
 *
 * @param {string} label - 8 characters long.
 *
 * @returns {number | null} Either a hexadecimal number if the input label meets
 * specific conditions, or null otherwise.
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
 * @description Converts a hexadecimal-encoded string to a `Uint8Array`. It uses the
 * Node.js `Buffer` class and its `from` method with the `'hex'` encoding option,
 * allowing for efficient conversion between binary data and hexadecimal representations.
 *
 * @param {string} hex - Expected to contain hexadecimal data.
 *
 * @returns {Uint8Array} An array-like object that represents a sequence of 8-bit
 * unsigned integers. Each integer represents a byte in the input hexadecimal string.
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
 * @description Calculates the cyclic redundancy check (CRC-8) for a given Uint8Array
 * and an optional previous CRC value. It iterates over each byte in the array, updates
 * the CRC using a lookup table, and returns the final result as a number.
 *
 * @param {Uint8Array} current - Intended for data calculation.
 *
 * @param {number} previous - Used as an initial value for the CRC calculation.
 *
 * @returns {number} 8-bit cyclic redundancy check (CRC) for the input data.
 */
export function crc8(current: Uint8Array, previous = 0): number {
  let crc = ~~previous;

  for (let index = 0; index < current.length; index++) {
    crc = TABLE[(crc ^ current[index]) & 0xff] & 0xff;
  }

  return crc;
}

/**
 * @description Converts a Base64-encoded string to its corresponding Unicode
 * representation. It uses the `atob` function to decode the Base64 string, then maps
 * each character code point to its hexadecimal representation with leading zeros and
 * concatenates them with `%` symbols.
 *
 * @param {string} str - Base64-encoded string data.
 *
 * @returns {string} A URL-encoded representation of the input base64-encoded string,
 * converted to its corresponding Unicode characters.
 */
export const base64ToUnicode = (str: string) => {
  return decodeURIComponent(
    atob(str)
      .split('')
      .map((c) => {
        // URL-encodes each character.

        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(''),
  );
};
/**
 * @description Converts a hexadecimal string to an ASCII string by iterating over
 * the input string two characters at a time, interpreting each pair as a hexadecimal
 * number and then converting it to its corresponding ASCII character using the
 * `String.fromCharCode` method.
 *
 * @param {string} str1 - Expected to be a hexadecimal string.
 *
 * @returns {string} A human-readable representation of the input hexadecimal string
 * converted into ASCII characters.
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
 * @description Converts a Unicode string to Base64 format. It first encodes the input
 * string using UTF-8, then replaces each hexadecimal-encoded byte sequence with its
 * corresponding Unicode code point, and finally applies Base64 encoding to produce
 * the final output.
 *
 * @param {string} str - Encoded input Unicode string to be converted to Base64.
 *
 * @returns {string} Base64-encoded representation of a given input string after
 * replacing all occurrences of Unicode characters with their corresponding ASCII values.
 */
export function unicodeToBase64(str: string) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function toSolidBytes(match, p1) {
      // Converts hexadecimal bytes to characters.

      return String.fromCharCode(Number('0x' + p1));
    }),
  );
}
/**
 * @description Converts a Data URI to a string, handling different encoding types
 * such as Base64 and UTF-8. It extracts the encoded data from the URI, decodes it
 * accordingly, and returns the resulting string.
 *
 * @param {string} dataURI - Used to process data URIs.
 *
 * @returns {string} A decoded representation of the original data URI.
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
 * iterating over each character, getting its Unicode code point using `charCodeAt`,
 * converting it to hexadecimal using `toString(16)`, and then joining the resulting
 * array of hex values into a single string.
 *
 * @param {string} str - Intended to be converted into hexadecimal ASCII representation.
 *
 * @returns {string} A concatenation of hexadecimal representations of ASCII codes
 * for each character in the input string.
 */
export function asciiToHex(str: string) {
  const arr1 = [];
  for (let n = 0, l = str.length; n < l; n++) {
    const hex = Number(str.charCodeAt(n)).toString(16);
    arr1.push(hex);
  }
  return arr1.join('');
}
