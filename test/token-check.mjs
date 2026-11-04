// Checks a real token against the vault before you trust it with anything. It runs on a private
// copy of the live chain on this machine, so it sends no real transactions and spends nothing.
// Usage: npm run check:token -- <token address> [rpc url]. Needs Foundry.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { encodeBurn, encodeClaim, keccak, makeSigner, rpcClient, selector } from '../server/chain.mjs';

const token = String(process.argv[2] || '').toLowerCase(), upstream = process.argv[3] || 'https://robinhood-rpc.publicnode.com';
if (!/^0x[0-9a-f]{40}$/.test(token)) { console.error('Usage: npm run check:token -- <token address> [rpc url]'); process.exit(1); }
const PORT = 18547, RPC = `http://127.0.0.1:${PORT}`, env = { ...process.env, PATH: `${homedir()}/.foundry/bin:${process.env.PATH}` };
const UNIT = 10n ** 18n, chainIdFor = 4663;
// Anvil's well-known test account. It exists only on this private copy.
const OWNER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PLAYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', OTHER = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const rpc = rpcClient(RPC), word = v => (typeof v === 'string' ? v.replace(/^0x/, '') : v.toString(16)).padStart(64, '0');
const signer = makeSigner('0x' + randomBytes(32).toString('hex'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const read = async (to, sig, ...args) => BigInt(await rpc.call('eth_call', [{ to, data: selector(sig) + args.map(word).join('') }, 'latest']));
const balance = a => read(token, 'balanceOf(address)', a);
const supply = () => read(token, 'totalSupply()');
async function send(from, to, data) {
  const hash = await rpc.call('eth_sendTransaction', [{ from, to, data }]);
  for (let i = 0; i < 200; i++) { const r = await rpc.call('eth_getTransactionReceipt', [hash]); if (r) return r; await new Promise(res => setTimeout(res, 25)); }
  throw new Error('no receipt');
}
const tries = async fn => { try { return (await fn()).status === '0x1'; } catch { return false; } };

const anvil = spawn('anvil', ['--port', String(PORT), '--fork-url', upstream, '--chain-id', String(chainIdFor), '--silent', '--no-storage-caching'], { env, stdio: 'ignore' });
let code = 1;
try {
  for (let i = 0; i < 100; i++) { try { await rpc.call('eth_chainId'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  check('the token exists on this chain', (await rpc.call('eth_getCode', [token, 'latest'])).length > 2);
  check('it has 18 decimals', await read(token, 'decimals()') === 18n);
  // Hand the test wallet some tokens on this private copy, by finding the balance slot.
  const amount = 10000n * UNIT;
  let slot = -1;
  for (let i = 0; i < 12 && slot < 0; i++) {
    const key = '0x' + keccak(Buffer.from(word(PLAYER) + word(BigInt(i)), 'hex')).toString('hex');
    await rpc.call('anvil_setStorageAt', [token, key, '0x' + word(amount)]);
    if (await balance(PLAYER) === amount) slot = i; else await rpc.call('anvil_setStorageAt', [token, key, '0x' + word(0n)]);
  }
  if (slot < 0) throw new Error('could not find the balance storage slot on this token');
  execFileSync('forge', ['build', '--offline'], { env, stdio: 'ignore' });
  const out = execFileSync('forge', ['create', '--offline', '--broadcast', '--rpc-url', RPC, '--private-key', KEY, 'contracts/src/DNDVault.sol:DNDVault', '--constructor-args', token, OWNER, signer.address, '5000', '5000'], { env, encoding: 'utf8' });
  const vault = out.match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1].toLowerCase();
  check('the vault accepts this token', true);
  const domainChain = chainIdFor, now = Number((await rpc.call('eth_getBlockByNumber', ['latest', false])).timestamp), expiry = now + 3600;
  // Deposit: moves freely into a contract, with no tax, before or after graduation.
  check('a wallet can approve the vault', await tries(() => send(PLAYER, token, selector('approve(address,uint256)') + word(vault) + word(1000n * UNIT))));
  check('a deposit works, and the vault receives the exact amount', await tries(() => send(PLAYER, vault, selector('deposit(uint256)') + word(1000n))), `vault holds ${(await balance(vault)) / UNIT}`);
  check('deposits are not taxed', await balance(vault) === 1000n * UNIT);
  // Claim: pays the exact amount out.
  const nonce = '0x' + randomBytes(32).toString('hex'), before = await balance(OTHER);
  const f = { chainId: domainChain, vault, to: OTHER, whole: 100, nonce, expiry };
  check('a voucher pays out', await tries(() => send(OWNER, vault, encodeClaim({ ...f, ...signer.signClaim(f) }))));
  check('payouts are not taxed', await balance(OTHER) - before === 100n * UNIT);
  // Burn: does total supply really fall?
  const s0 = await supply(), nb = '0x' + randomBytes(32).toString('hex'), fb = { chainId: domainChain, vault, whole: 50, nonce: nb, expiry }, v0 = await balance(vault);
  check('a burn voucher works', await tries(() => send(OWNER, vault, encodeBurn({ ...fb, ...signer.signBurn(fb) }))));
  check('the vault shrank by the burn', v0 - await balance(vault) === 50n * UNIT);
  const reduced = s0 - await supply() === 50n * UNIT;
  check('total supply really fell', reduced, reduced ? 'a true burn' : 'sent to the dead address instead');
  // A hero purchase: the wallet burns tokens itself, and the server looks for this exact record on the chain.
  const direct = await send(PLAYER, token, '0x42966c68' + word(100n * UNIT));
  const burnLog = direct.logs.find(l => l.address.toLowerCase() === token && l.topics[0] === '0x' + keccak(Buffer.from('Transfer(address,address,uint256)')).toString('hex'));
  check('a wallet can burn directly', direct.status === '0x1');
  check('the burn shows on the chain as tokens going to the zero address', !!burnLog && burnLog.topics[1].slice(-40) === PLAYER.slice(2) && /^0x0+$/.test(burnLog.topics[2]) && BigInt(burnLog.data) === 100n * UNIT);
  code = results.every(Boolean) ? 0 : 1;
  console.log(code ? '\nThis token does NOT work with the vault as it stands.' : '\nThis token works with the vault. Nothing real was sent.');
} catch (e) {
  console.error(`Could not finish: ${e.message}`);
} finally {
  anvil.kill();
}
process.exit(code);
