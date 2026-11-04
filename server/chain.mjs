// The blockchain maths, using only Node's own crypto: wallet signatures, the vault's vouchers
// and a small JSON-RPC client. The server signs vouchers but never sends a transaction or
// holds any tokens, so the only secret here is the voucher key.
import { createECDH, createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

export const keccak = data => createHash('keccak-256').update(data).digest();
const strip = hex => (hex.startsWith('0x') ? hex.slice(2) : hex);
export const hexToBuf = hex => Buffer.from(strip(hex), 'hex');
export const isEvmAddress = v => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
export const isHash32 = v => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);

// EIP-55: the mixed-case form of an address that wallets expect in a sign-in message.
export function toChecksum(address) {
  const lower = strip(address).toLowerCase(), hash = keccak(lower).toString('hex');
  return '0x' + [...lower].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}

// ---------------------------------------------------------------- secp256k1 recovery
// Works out which address produced a signature. This handles only public data, so plain
// BigInt arithmetic is fine here. Signing itself goes through OpenSSL, below.
const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const G = [0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n, 1n];
const mod = (a, m = P) => ((a % m) + m) % m;
function inverse(a, m = P) {
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return mod(s0, m);
}
function power(b, e) { let r = 1n; b = mod(b); while (e) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; }
function dbl([X, Y, Z]) {
  if (!Y || !Z) return [0n, 1n, 0n];
  const YY = Y * Y % P, S = 4n * X * YY % P, M = 3n * X * X % P, X3 = mod(M * M - 2n * S);
  return [X3, mod(M * (S - X3) - 8n * YY * YY), 2n * Y * Z % P];
}
function add(a, b) {
  if (!a[2]) return b;
  if (!b[2]) return a;
  const [X1, Y1, Z1] = a, [X2, Y2, Z2] = b;
  const Z1Z1 = Z1 * Z1 % P, Z2Z2 = Z2 * Z2 % P, U1 = X1 * Z2Z2 % P, U2 = X2 * Z1Z1 % P, S1 = Y1 * Z2 * Z2Z2 % P, S2 = Y2 * Z1 * Z1Z1 % P;
  if (U1 === U2) return S1 === S2 ? dbl(a) : [0n, 1n, 0n];
  const H = mod(U2 - U1), R = mod(S2 - S1), HH = H * H % P, HHH = H * HH % P, V = U1 * HH % P, X3 = mod(R * R - HHH - 2n * V);
  return [X3, mod(R * (V - X3) - S1 * HHH), H * Z1 * Z2 % P];
}
function mul(point, k) { let out = [0n, 1n, 0n], q = point; while (k) { if (k & 1n) out = add(out, q); q = dbl(q); k >>= 1n; } return out; }
const big = buf => BigInt('0x' + (Buffer.isBuffer(buf) ? buf.toString('hex') : strip(buf)));
const word = n => Buffer.from(BigInt(n).toString(16).padStart(64, '0'), 'hex');

// Returns the lowercase address that signed this 32-byte digest, or null if the numbers are invalid.
export function recoverAddress(digest, v, r, s) {
  const recId = v >= 27 ? v - 27 : v;
  if (recId !== 0 && recId !== 1) return null;
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const x = r, y2 = mod(x * x * x + 7n);
  let y = power(y2, (P + 1n) / 4n);
  if (y * y % P !== y2) return null;
  if ((y & 1n) !== BigInt(recId)) y = P - y;
  const rInv = inverse(r, N), u1 = mod(-big(digest) * rInv, N), u2 = mod(s * rInv, N);
  const Q = add(mul(G, u1), mul([x, y, 1n], u2));
  if (!Q[2]) return null;
  const zi = inverse(Q[2]), zi2 = zi * zi % P;
  const pub = Buffer.concat([word(Q[0] * zi2 % P), word(Q[1] * zi2 % P * zi % P)]);
  return '0x' + keccak(pub).subarray(12).toString('hex');
}
// What a wallet's personal_sign signs: a prefix, then the message.
export const personalDigest = message => {
  const body = Buffer.from(message, 'utf8');
  return keccak(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`, 'utf8'), body]));
};
export function verifyEvm(message, signature, address) {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
  const raw = hexToBuf(signature);
  const got = recoverAddress(personalDigest(message), raw[64], big(raw.subarray(0, 32)), big(raw.subarray(32, 64)));
  return got !== null && got === address.toLowerCase();
}

// ---------------------------------------------------------------- Solana
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Decode(text) {
  if (typeof text !== 'string' || !text.length) return null;
  let n = 0n;
  for (const c of text) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const hex = n.toString(16), body = n ? Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex') : Buffer.alloc(0);
  let zeros = 0;
  while (text[zeros] === '1') zeros++;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}
export const isSolanaAddress = v => { const b = typeof v === 'string' && v.length <= 44 ? base58Decode(v) : null; return !!b && b.length === 32; };
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
export function verifySolana(message, signatureB64, address) {
  if (typeof signatureB64 !== 'string' || signatureB64.length > 100) return false;
  const sig = Buffer.from(signatureB64, 'base64');
  if (sig.length !== 64 || !isSolanaAddress(address)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, base58Decode(address)]), format: 'der', type: 'spki' });
    return cryptoVerify(null, Buffer.from(message, 'utf8'), key, sig);
  } catch { return false; }
}

// ---------------------------------------------------------------- vouchers
const typeHash = text => keccak(Buffer.from(text));
const DOMAIN_TYPE = typeHash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
const CLAIM_TYPE = typeHash('Claim(address to,uint256 whole,bytes32 nonce,uint256 expiry)');
const BURN_TYPE = typeHash('Burn(uint256 whole,bytes32 nonce,uint256 expiry)');
const addressWord = a => word(big(a));
// The exact bytes the vault's claimDigest hashes. The digest itself is keccak of this.
const voucherDomain = ({ chainId, vault }) => keccak(Buffer.concat([DOMAIN_TYPE, typeHash('DNDVault'), typeHash('1'), word(chainId), addressWord(vault)]));
export function claimPreimage(f) {
  const struct = keccak(Buffer.concat([CLAIM_TYPE, addressWord(f.to), word(f.whole), hexToBuf(f.nonce), word(f.expiry)]));
  return Buffer.concat([Buffer.from([0x19, 0x01]), voucherDomain(f), struct]);
}
export function burnPreimage(f) {
  const struct = keccak(Buffer.concat([BURN_TYPE, word(f.whole), hexToBuf(f.nonce), word(f.expiry)]));
  return Buffer.concat([Buffer.from([0x19, 0x01]), voucherDomain(f), struct]);
}
// Loads the voucher key into OpenSSL. The raw key goes no further than this function.
export function makeSigner(privateKeyHex) {
  if (typeof privateKeyHex !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(privateKeyHex)) throw new Error('The voucher key must be 32 bytes of hex.');
  const raw = hexToBuf(privateKeyHex), ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(raw);
  const pub = ecdh.getPublicKey();
  const b64 = b => b.toString('base64url');
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'secp256k1', d: b64(raw), x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) }, format: 'jwk' });
  const address = '0x' + keccak(pub.subarray(1)).subarray(12).toString('hex');
  function signPreimage(preimage) {
    const digest = keccak(preimage), sig = cryptoSign('keccak-256', preimage, { key, dsaEncoding: 'ieee-p1363' });
    const r = big(sig.subarray(0, 32));
    let s = big(sig.subarray(32, 64));
    if (s > N / 2n) s = N - s; // the vault only accepts the low form
    for (const v of [27, 28]) {
      if (recoverAddress(digest, v, r, s) === address) return { v, r: '0x' + word(r).toString('hex'), s: '0x' + word(s).toString('hex') };
    }
    throw new Error('Could not produce a valid voucher signature.');
  }
  return { address, signClaim: f => signPreimage(claimPreimage(f)), signBurn: f => signPreimage(burnPreimage(f)) };
}

// ---------------------------------------------------------------- calling contracts
export const selector = signature => '0x' + keccak(Buffer.from(signature)).subarray(0, 4).toString('hex');
export const topic = signature => '0x' + keccak(Buffer.from(signature)).toString('hex');
const pad = buf => buf.toString('hex');
export const encodeClaim = ({ to, whole, nonce, expiry, v, r, s }) => selector('claim(address,uint256,bytes32,uint256,uint8,bytes32,bytes32)') +
  pad(addressWord(to)) + pad(word(whole)) + strip(nonce) + pad(word(expiry)) + pad(word(v)) + strip(r) + strip(s);
export const encodeBurn = ({ whole, nonce, expiry, v, r, s }) => selector('burn(uint256,bytes32,uint256,uint8,bytes32,bytes32)') +
  pad(word(whole)) + strip(nonce) + pad(word(expiry)) + pad(word(v)) + strip(r) + strip(s);
export const BURNED = topic('Burned(bytes32,uint256,bool)');
export const DEPOSITED = topic('Deposited(address,uint256)');
export const CLAIMED = topic('Claimed(bytes32,address,uint256)');
export const topicAddress = t => '0x' + strip(t).slice(24).toLowerCase();

export function rpcClient(url, { timeoutMs = 12000 } = {}) {
  let id = 0;
  return {
    async call(method, params = []) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`The chain node answered ${res.status}.`);
      const body = await res.json();
      if (body.error) throw new Error(`The chain node refused ${method}: ${body.error.message || body.error.code}`);
      return body.result;
    },
  };
}

// ---------------------------------------------------------------- settings
// Network details from the public chain registry, checked against a live node on 2026-11-04.
// The server still asks the node for its chain ID at startup and refuses to run on a mismatch.
export const ROBINHOOD = { chainId: 4663, name: 'Robinhood Chain', currency: 'ETH', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' };
// The nodes that check hero burns. Only reads, so public nodes are fine, and any one can answer.
export function readHeroBurnEnv(env, token) {
  if (env.HERO_BURN === '0') return null;
  return { token: token.toLowerCase(), chainId: ROBINHOOD.chainId, rpcs: [env.DND_RPC, 'https://robinhood-rpc.publicnode.com', ROBINHOOD.rpc].filter(Boolean) };
}
export function readChainEnv(env) {
  // The start block is required: without it the server would scan the whole chain from block zero.
  const need = ['DND_TOKEN', 'DND_VAULT', 'DND_VOUCHER_KEY', 'DND_START_BLOCK'];
  const set = need.filter(k => env[k]);
  if (!set.length) return null;
  if (set.length < need.length) throw new Error(`Live token mode needs all of ${need.join(', ')}. Missing: ${need.filter(k => !env[k]).join(', ')}.`);
  for (const k of ['DND_TOKEN', 'DND_VAULT']) if (!isEvmAddress(env[k])) throw new Error(`${k} is not a valid address.`);
  if (!/^\d+$/.test(env.DND_START_BLOCK)) throw new Error('DND_START_BLOCK must be the block number the vault was deployed in.');
  if (env.DND_TREASURY && !isEvmAddress(env.DND_TREASURY)) throw new Error('DND_TREASURY is not a valid address.');
  if (env.DND_MARKET_URL && !/^https:\/\/[^\s"'<>]+$/.test(env.DND_MARKET_URL)) throw new Error('DND_MARKET_URL must be an https link.');
  const finality = env.DND_FINALITY || 'safe';
  if (!['safe', 'finalized'].includes(finality) && !/^\d+$/.test(finality)) throw new Error('DND_FINALITY must be safe, finalized or a number of blocks.');
  return {
    chainId: Number(env.DND_CHAIN_ID || ROBINHOOD.chainId), name: env.DND_CHAIN_NAME || ROBINHOOD.name, currency: ROBINHOOD.currency,
    rpc: env.DND_RPC || ROBINHOOD.rpc, publicRpc: env.DND_PUBLIC_RPC || ROBINHOOD.rpc, explorer: env.DND_EXPLORER || ROBINHOOD.explorer,
    token: env.DND_TOKEN.toLowerCase(), vault: env.DND_VAULT.toLowerCase(), treasury: env.DND_TREASURY ? env.DND_TREASURY.toLowerCase() : null,
    market: env.DND_MARKET_URL || null, signerKey: env.DND_VOUCHER_KEY, startBlock: Number(env.DND_START_BLOCK), finality: /^\d+$/.test(finality) ? Number(finality) : finality,
    pollMs: Number(env.DND_POLL_MS || 15000),
  };
}
