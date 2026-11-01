import net from 'node:net';
import path from 'node:path';
import { mkdir, realpath, readFile, open, rename, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { digest } from './canonical.mjs';
import { TeamError, invariant } from './errors.mjs';

export async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function ensureDirectory(directory) {
  const created = [];
  let current = path.resolve(directory);
  while (true) {
    try { await lstat(current); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; created.push(current); current = path.dirname(current); }
  }
  for (const item of created.reverse()) {
    await mkdir(item);
    await syncDirectory(path.dirname(item));
  }
  await syncDirectory(directory);
}

export async function atomicReplace(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(data, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Single local-machine Host writer. OS socket ownership spans every guarded IO. */
export class TeamWriterLease {
  #server;
  #root;
  #identity;
  #active = false;
  #closing = false;
  #acquiring = false;
  #operations = new Set();
  #token;
  #port;
  constructor(options = {}) {
    invariant(Object.keys(options).length === 0, 'team/invalid-action', 'Lease port is derived exclusively from the canonical root');
  }
  get root() { return this.#root; }
  get port() { return this.#port; }
  get workspaceIdentity() { return this.#identity; }
  async acquire(root, ownerId = randomUUID()) {
    invariant(!this.#server && !this.#acquiring, 'team/lease-conflict', 'Lease instance already acquired');
    invariant(typeof ownerId === 'string' && ownerId.length > 0, 'team/invalid-action', 'ownerId is required');
    invariant(typeof root === 'string' && !/^\\\\|^\/\//.test(root), 'team/unavailable', 'Lease requires a local filesystem root');
    this.#acquiring = true;
    this.#closing = false;
    let server;
    try {
      await mkdir(root, { recursive: true });
      this.#root = await realpath(root);
      invariant(!/^\\\\/.test(this.#root), 'team/unavailable', 'UNC roots are unsupported');
      this.#identity = process.platform === 'win32' ? this.#root.toLowerCase() : this.#root;
      this.#port = 20000 + Number.parseInt(digest(this.#identity).slice(0, 8), 16) % 40000;
      server = net.createServer(socket => socket.destroy());
      await new Promise((resolve, reject) => {
        const fail = error => reject(new TeamError('team/lease-conflict', `Writer port ${this.#port} is unavailable`, { retryable: true }, { cause: error }));
        server.once('error', fail);
        server.listen({ host: '127.0.0.1', port: this.#port, exclusive: true }, () => { server.off('error', fail); resolve(); });
      });
      this.#server = server;
      server.on('error', () => { this.#active = false; });
      server.on('close', () => { this.#active = false; });
      let epoch = 0;
      try {
        const previous = JSON.parse(await readFile(path.join(this.#root, '.writer.json'), 'utf8'));
        invariant(previous !== null && typeof previous === 'object' && Number.isSafeInteger(previous.epoch) && previous.epoch >= 1, 'team/lease-lost', 'Invalid lease epoch');
        epoch = previous.epoch;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          if (error instanceof TeamError) throw error;
          throw new TeamError('team/lease-lost', 'Writer metadata is invalid', { retryable: false }, { cause: error });
        }
      }
      invariant(epoch < Number.MAX_SAFE_INTEGER, 'team/lease-lost', 'Lease epoch exhausted');
      this.#token = { ownerId, epoch: epoch + 1, fencingToken: randomUUID() };
      await atomicReplace(path.join(this.#root, '.writer.json'), JSON.stringify(this.#token));
      this.#active = true;
      return { ...this.#token };
    } catch (error) {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      this.#server = undefined;
      throw error;
    } finally { this.#acquiring = false; }
  }
  async assert(token) {
    invariant(this.#active && this.#server?.listening && this.#matches(token), 'team/lease-lost', 'Writer fencing no longer valid');
    let current;
    try { current = JSON.parse(await readFile(path.join(this.#root, '.writer.json'), 'utf8')); }
    catch (cause) { throw new TeamError('team/lease-lost', 'Writer metadata is unavailable', {}, { cause }); }
    invariant(current?.ownerId === token.ownerId && current.epoch === token.epoch && current.fencingToken === token.fencingToken, 'team/lease-lost', 'Writer fencing changed');
  }
  #matches(token) {
    return this.#token && token && token.ownerId === this.#token.ownerId && token.epoch === this.#token.epoch && token.fencingToken === this.#token.fencingToken;
  }
  /** Independent teams may run concurrently; teardown drains admitted operations. */
  guard(token, work) {
    if (this.#closing) return Promise.reject(new TeamError('team/lease-lost', 'Writer is closing'));
    const result = (async () => { await this.assert(token); return work(); })();
    this.#operations.add(result);
    const remove = () => this.#operations.delete(result);
    void result.then(remove, remove);
    return result;
  }
  async renew(ownerId, epoch, fencingToken) {
    invariant(!this.#closing, 'team/lease-lost', 'Writer is closing');
    await this.assert({ ownerId, epoch, fencingToken });
    return { ...this.#token };
  }
  async status() { return this.#active ? { ...this.#token } : {}; }
  async release(ownerId, epoch, fencingToken) {
    if (!this.#server) return;
    invariant(this.#matches({ ownerId, epoch, fencingToken }), 'team/lease-lost', 'Release token mismatch');
    this.#closing = true;
    await Promise.allSettled([...this.#operations]);
    this.#active = false;
    await new Promise((resolve, reject) => this.#server.close(error => error ? reject(error) : resolve()));
    this.#server = undefined;
  }
}
