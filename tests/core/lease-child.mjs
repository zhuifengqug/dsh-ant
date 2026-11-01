import { TeamWriterLease } from '../../src/core/writer-lease.mjs';
const lease = new TeamWriterLease();
try {
  const token = await lease.acquire(process.argv[2], 'child-host');
  process.stdout.write(`${JSON.stringify({ ok: true, token, port: lease.port })}\n`);
  if (process.argv[3] === 'hold') process.stdin.resume();
  else await lease.release(token.ownerId, token.epoch, token.fencingToken);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: error.code, message: error.message })}\n`);
  process.exitCode = 2;
}
