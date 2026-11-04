// Finds crypto wallets in the browser and talks to them. Ethereum-type wallets announce
// themselves through EIP-6963, so several can sit side by side without fighting over one object.
// The game never sees a private key: wallets sign inside their own windows.
(function (root) {
'use strict';
const found = new Map();
let onChange = () => {};
const INSTALL = [
  { id: 'io.metamask', name: 'MetaMask', url: 'https://metamask.io/download/' },
  { id: 'app.phantom', name: 'Phantom', url: 'https://phantom.com/download' },
];
function add(id, name, icon, kind, provider) {
  if (found.has(id)) return;
  const safeIcon = typeof icon === 'string' && /^data:image\/(png|svg\+xml|webp|jpeg|gif)[;,]/.test(icon) ? icon : null;
  found.set(id, { id, name: String(name || 'Wallet').slice(0, 40), icon: safeIcon, kind, provider });
  onChange();
}
addEventListener('eip6963:announceProvider', e => {
  const d = e.detail;
  if (d && d.info && d.provider && typeof d.provider.request === 'function') add(d.info.rdns || d.info.uuid, d.info.name, d.info.icon, 'evm', d.provider);
});
function scan() {
  dispatchEvent(new Event('eip6963:requestProvider'));
  // Older wallets that only set window.ethereum.
  setTimeout(() => {
    const eth = root.ethereum;
    if (eth && typeof eth.request === 'function' && ![...found.values()].some(w => w.kind === 'evm')) add('injected', eth.isMetaMask ? 'MetaMask' : eth.isPhantom ? 'Phantom' : 'Browser wallet', null, 'evm', eth);
    const sol = [['phantom.solana', 'Phantom (Solana)', root.phantom && root.phantom.solana], ['solflare', 'Solflare', root.solflare], ['backpack', 'Backpack', root.backpack]];
    for (const [id, name, p] of sol) if (p && typeof p.signMessage === 'function') add(id, name, null, 'sol', p);
  }, 250);
}
const utf8Hex = text => '0x' + [...new TextEncoder().encode(text)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64 = bytes => btoa(String.fromCharCode(...bytes));
// Plain words for the errors wallets return.
function explain(e) {
  const code = e && (e.code ?? (e.error && e.error.code));
  if (code === 4001 || code === 'ACTION_REJECTED') return 'You cancelled that in your wallet.';
  if (code === -32002) return 'Your wallet is already waiting for you. Open it to continue.';
  return (e && (e.shortMessage || e.message)) || 'Your wallet could not do that.';
}
async function signIn(id, api, purpose) {
  const w = found.get(id);
  if (!w) throw new Error('That wallet is not available any more.');
  if (w.kind === 'evm') {
    const [address] = await w.provider.request({ method: 'eth_requestAccounts' });
    const ch = await api('/api/wallet/challenge', { kind: 'evm', address, purpose });
    const signature = await w.provider.request({ method: 'personal_sign', params: [utf8Hex(ch.message), address] });
    return { nonce: ch.nonce, signature, address };
  }
  const res = await w.provider.connect();
  const address = String((res && res.publicKey) || w.provider.publicKey);
  const ch = await api('/api/wallet/challenge', { kind: 'sol', address, purpose });
  const out = await w.provider.signMessage(new TextEncoder().encode(ch.message), 'utf8');
  return { nonce: ch.nonce, signature: b64(out.signature || out), address };
}
// The browser's wallet that currently holds this address, if any.
async function evmHolding(address) {
  const want = address.toLowerCase();
  const list = [...found.values()].filter(w => w.kind === 'evm');
  let saved = null;
  try { saved = localStorage.getItem('tf.wallet'); } catch (e) { /* storage is optional */ }
  list.sort((a, b) => (b.id === saved) - (a.id === saved));
  for (const w of list) {
    try {
      const accounts = await w.provider.request({ method: 'eth_accounts' });
      if (accounts.some(a => a.toLowerCase() === want)) return w;
    } catch (e) { /* this wallet is locked or refused, so try the next */ }
  }
  return null;
}
const chainHex = id => '0x' + Number(id).toString(16);
async function currentChain(w) { return Number(await w.provider.request({ method: 'eth_chainId' })); }
async function ensureChain(w, cfg) {
  if (await currentChain(w) === cfg.chainId) return;
  try {
    await w.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex(cfg.chainId) }] });
  } catch (e) {
    const code = e && (e.code ?? (e.data && e.data.originalError && e.data.originalError.code));
    if (code === 4001) throw e;
    if (w.provider.isPhantom || /phantom/i.test(w.name)) throw new Error(`In Phantom, open Settings, then Active Networks, and turn on ${cfg.chainName}.`);
    if (code !== 4902 && code !== -32603) throw e;
    await w.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: chainHex(cfg.chainId), chainName: cfg.chainName, nativeCurrency: { name: 'Ether', symbol: cfg.currency, decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: cfg.explorer ? [cfg.explorer] : undefined }] });
  }
  if (await currentChain(w) !== cfg.chainId) throw new Error(`Your wallet did not switch to ${cfg.chainName}.`);
}
const word = v => BigInt(v).toString(16).padStart(64, '0');
const addr = a => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const UNIT = 10n ** 18n;
async function waitFor(w, hash) {
  for (let i = 0; i < 180; i++) {
    const r = await w.provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (r) { if (Number(r.status) !== 1) throw new Error('The network rejected that transaction. Nothing moved.'); return r; }
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error('That transaction is taking a long time. Check your wallet before trying again.');
}
const sendTx = (w, from, to, data) => w.provider.request({ method: 'eth_sendTransaction', params: [{ from, to, data }] });
// Approves exactly this amount, never an open-ended allowance, then deposits it.
async function deposit(w, from, cfg, whole, onStep) {
  const units = BigInt(whole) * UNIT, S = cfg.selectors;
  const allowed = BigInt(await w.provider.request({ method: 'eth_call', params: [{ to: cfg.token, data: S.allowance + addr(from) + addr(cfg.vault) }, 'latest'] }));
  if (allowed < units) {
    onStep('Step 1 of 2: approve in your wallet.');
    await waitFor(w, await sendTx(w, from, cfg.token, S.approve + addr(cfg.vault) + word(units)));
  }
  onStep(allowed < units ? 'Step 2 of 2: confirm the deposit in your wallet.' : 'Confirm the deposit in your wallet.');
  const hash = await sendTx(w, from, cfg.vault, S.deposit + word(whole));
  await waitFor(w, hash);
  return hash;
}
async function claim(w, from, cfg, data) {
  const hash = await sendTx(w, from, cfg.vault, data);
  await waitFor(w, hash);
  return hash;
}
async function balances(w, from, cfg) {
  const [token, gas] = await Promise.all([
    cfg.token ? w.provider.request({ method: 'eth_call', params: [{ to: cfg.token, data: cfg.selectors.balanceOf + addr(from) }, 'latest'] }) : '0x0',
    w.provider.request({ method: 'eth_getBalance', params: [from, 'latest'] }),
  ]);
  return { token: BigInt(token) / UNIT, gas: Number(BigInt(gas) / 10n ** 12n) / 1e6 };
}
root.Wallet = {
  scan, signIn, evmHolding, ensureChain, currentChain, deposit, claim, balances, explain, INSTALL,
  list: () => [...found.values()],
  onChange: fn => { onChange = fn; },
  remember: id => { try { localStorage.setItem('tf.wallet', id); } catch (e) { /* storage is optional */ } },
};
})(window);
