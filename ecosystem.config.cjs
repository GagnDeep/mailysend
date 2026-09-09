/**
 * PM2 process definition for the Node deployment.
 *
 * The nginx block on the host proxies `mailysend.com` to `localhost:8917`, so
 * that port is not a preference — it is the contract with the reverse proxy.
 */
module.exports = {
  apps: [
    {
      name: 'mailysend',
      cwd: __dirname,
      // Not `.output/server/server.js` directly: that artifact is a Worker-shaped
      // module (`export default { fetch, queue, email, scheduled }`) with no
      // socket. `node-server.mjs` is the listener that adapts it and serves
      // `.output/client`.
      script: 'apps/app/node-server.mjs',
      // `fork`, and exactly one instance. The Node platform backs Durable
      // Objects with in-process actors, and an actor's whole purpose is to be a
      // single serialisation point per key — two processes would each hold
      // their own copy of every broadcast cursor and sending governor, and the
      // daily quota governor would grant twice what it should. Scaling out on
      // Node means putting the actors behind a shared service, not adding
      // workers here.
      exec_mode: 'fork',
      instances: 1,
      // Secrets (MS_SECRET, provider credentials) live in a `.env` beside this
      // file, which is never committed. `--env-file-if-exists` means the same
      // command works on a box that has not been configured yet, which is what
      // makes the first boot legible instead of a crash loop.
      node_args: '--enable-source-maps --env-file-if-exists=.env',
      env: {
        NODE_ENV: 'production',
        PORT: 8917,
        HOST: '127.0.0.1',
        MS_MODE: 'single',
        MS_DATA_DIR: `${__dirname}/.data`,
      },
      // The runtime holds SQLite handles and a queue poller; a hard kill mid-
      // batch is safe (the lease expires) but a clean drain is cheaper.
      kill_timeout: 12000,
      wait_ready: false,
      listen_timeout: 20000,
      max_restarts: 10,
      min_uptime: '20s',
      // A leak would otherwise take the site down rather than restart it.
      max_memory_restart: '900M',
      autorestart: true,
      merge_logs: true,
      time: true,
      out_file: `${__dirname}/logs/mailysend.out.log`,
      error_file: `${__dirname}/logs/mailysend.err.log`,
    },
  ],
}
