import pgCon from 'pg';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { fromUnit, toUnit } from 'lucid-cardano';
let _networkId: number | null = null;
let _pgClient: pgCon.Client | null = null;
export const REFERENCE_TOKEN_LABEL = 100;
export const USER_TOKEN_LABEL = 222;
export const CIP25_LABEL = 721;

export const init = (networkId: 'mainnet' | 'testnet', connection: pgCon.Client) => {
  _networkId = networkId === 'testnet' ? 0 : 1;
  _pgClient = connection;
};

const ensureInit = () => {
  if (!_pgClient || !_networkId) throw new Error('Libcip54 error - please initialize before use');
};

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
export async function getTransactionsFromStake(stakeAddress: string, page: number = 0): Promise<any> {
  ensureInit();
  if (!_pgClient) return [];
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
  return txs;
}

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
export async function getTokensFromStake(
  stakeAddress: string,
  page: number = 0,
): Promise<{ unit: string; quantity: number }[]> {
  ensureInit();
  if (!_pgClient) return [];
  let assets: any = await _pgClient.query(
    `
    SELECT 
        concat(encode(multi_asset.policy, 'hex'), encode(multi_asset.name, 'hex')) AS unit, 
        sum(ma_tx_out.quantity) as quantity
    FROM multi_asset 
        JOIN ma_tx_out      ON (ma_tx_out.ident = multi_asset.id) 
        JOIN tx_out         ON (tx_out.id = ma_tx_out.tx_out_id)
        JOIN utxo_view      ON (utxo_view.id = ma_tx_out.tx_out_id) 
        JOIN stake_address  ON (stake_address.id = utxo_view.stake_address_id)
        JOIN tx             ON (tx.id = utxo_view.tx_id)
    WHERE (stake_address.view = $1::TEXT)
            AND tx.valid_contract = 'true'
    GROUP BY concat(encode(multi_asset.policy, 'hex'), encode(multi_asset.name, 'hex')) 
    `,
    [stakeAddress],
  );
  assets = assets.rows;
  return assets;
}

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
      LEFT JOIN datum d1  ON (d1.hash = tx_out.data_hash AND d1.tx_id = tx.id)
      LEFT JOIN datum d2  ON (d2.id = tx_out.inline_datum_id)
        WHERE (stake_address.view = $1::TEXT)
            AND tx.valid_contract = 'true'`,
    [stakeAddress],
  );
  utres = utres.rows;
  return utres;
}

export async function getLibraries(featureTree: {
  libraries: { name: string; version: string }[];
}): Promise<{ libraries: string[]; css: string[] }> {
  const ret: { libraries: string[]; css: string[] } = { libraries: [], css: [] };
  for (const library of featureTree.libraries) {
    const result = await fetch(
      'https://api.cdnjs.com/libraries/' + library.name + '/' + library.version + '?fields=name,version,files',
    );
    const json = await result.json();
    const files = json.files;
    const name = library.name;
    for (const file of files) {
      if (
        !file.includes('.min.') || // skip file if it doesn't include .min
        (name === 'three.js' && file.includes('.module.')) ||
        (name === 'phaser' && file.includes('-ie9')) ||
        (name === 'phaser' && file.includes('.esm.')) ||
        (name === 'phaser' && file.includes('arcade-physics'))
      ) {
        // for three.js don't load the module version
        continue;
      }
      const url = 'https://cdnjs.cloudflare.com/ajax/libs/' + library.name + '/' + library.version + '/' + file;
      const fresult = await fetch(url);
      const blob = await fresult.blob();
      const ab = await blob.arrayBuffer();
      const ia = new Uint8Array(ab);
      const tresult = new TextDecoder().decode(ia);
      const mType = blob.type.split(';')[0];
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

export const getMetadata = async (unit: string): Promise<any> => {
  if (!unit || unit.length < 1) return null;
  const { label, name, policyId, assetName } = fromUnit(unit);
  let metadata = null;
  if (!label || !labelIsCIP68(label)) {
    const mintTx = await getMintTx(unit);
    if (mintTx) {
      const nftMetadata: any = mintTx.metadata.filter((m: any) => m.key === 721)[0].json;
      const policyMetadata = nftMetadata[policyId];
      if (policyMetadata[Buffer.from(assetName || '', 'hex').toString()]) {
        metadata = policyMetadata[Buffer.from(assetName || '', 'hex').toString()];
      } else if (policyMetadata[assetName || '']) {
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

export const getMintTx = async (
  unit: string,
): Promise<{ txHash: string; metadata: { key: string; json: object }[] } | null> => {
  ensureInit();
  if (!_pgClient) return null;
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
  return mintTx.rows[0];
};

export const getCIP68Metadata = async (unit: string): Promise<any> => {
  ensureInit();
  if (!_pgClient) return [];

  let datum: any = await _pgClient.query(
    `
    SELECT           
        CASE WHEN d1.value IS NOT NULL THEN d1.value WHEN d2.value IS NOT NULL THEN d2.value ELSE NULL END datum
    FROM multi_asset
        JOIN ma_tx_out      ON (ma_tx_out.ident = multi_asset.id)
        JOIN tx_out         ON (tx_out.id = ma_tx_out.tx_out_id)
        JOIN tx             ON (tx.id = tx_out.tx_id)
        JOIN utxo_view      ON (utxo_view.id = ma_tx_out.tx_out_id) 
        LEFT JOIN datum d1  ON (d1.hash = tx_out.data_hash AND d1.tx_id = tx.id)
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

  return metadata;
};

// Util functions

export function getStake(baseAddress: string): string | null {
  ensureInit();
  const address = CSL.BaseAddress.from_address(CSL.Address.from_bech32(baseAddress));
  if (!address) return null;

  return CSL.RewardAddress.new(_networkId || 0, address.stake_cred())
    .to_address()
    .to_bech32()
    .toLowerCase();
}

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

export function validAddress(address: string) {
  try {
    return CSL.Address.from_bech32(address);
  } catch (e) {}

  try {
    return CSL.Address.from_hex(address);
  } catch (e) {}

  return;
}

export function validBech32Address(address: string) {
  try {
    return CSL.Address.from_bech32(address);
  } catch (e) {}
  return;
}

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

export const labelIsCIP68 = (label: number) => {
  if (!label) return false;
  return label === REFERENCE_TOKEN_LABEL || label === USER_TOKEN_LABEL;
};
