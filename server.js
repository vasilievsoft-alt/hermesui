const express = require('express');
const httpProxy = require('http-proxy');
const Docker = require('dockerode');
const crypto = require('crypto');
const path = require('path');

// Config
const PORT = parseInt(process.env.PORT || '3000', 10);
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const HERMES_IMAGE = process.env.HERMES_IMAGE || 'ghcr.io/nesquena/hermes-webui:latest';
const HERMES_NETWORK = process.env.HERMES_NETWORK || 'hermes-net';
const BASE_DOMAIN = process.env.BASE_DOMAIN || '';
const ACCESS_MODE = process.env.ACCESS_MODE || 'subdomain';
const PORT_RANGE_START = parseInt(process.env.PORT_RANGE_START || '8800', 10);
const PORT_RANGE_END = parseInt(process.env.PORT_RANGE_END || '8899', 10);
const PUBLIC_HOST = process.env.PUBLIC_HOST || '';
const INSTANCE_URL_SCHEME = process.env.INSTANCE_URL_SCHEME || (BASE_DOMAIN.endsWith('.traefik.me') ? 'http' : 'https');
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || '';
const HERMES_INSTANCE_PORT = parseInt(process.env.HERMES_INSTANCE_PORT || '8787', 10);

// Constants
const LABEL_MANAGED = 'hermes-manager.managed=true';
const LABEL_ID = 'hermes-manager.id';
const LABEL_PORT = 'hermes-manager.port';

// Docker client
const docker = new Docker({ socketPath: DOCKER_SOCKET });

// Proxy
const proxy = httpProxy.createProxyServer({});
proxy.on('error', (err, req, res) => {
  if (res && res.writable && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad gateway (instance not running?)');
  }
});

// Network
async function ensureNetwork() {
  try {
    await docker.getNetwork(HERMES_NETWORK).inspect();
  } catch (e) {
    await docker.createNetwork({ Name: HERMES_NETWORK, Driver: 'bridge' });
  }
  const hostname = process.env.HOSTNAME;
  if (!hostname) return;
  try {
    const self = await docker.getContainer(hostname).inspect();
    const nets = self.NetworkSettings && self.NetworkSettings.Networks;
    if (!nets || !nets[HERMES_NETWORK]) {
      await docker.getNetwork(HERMES_NETWORK).connect({ Container: hostname });
    }
  } catch (e) {
    // ignore self-attach failures (not running in docker)
  }
}

// Image
async function ensureImage() {
  try {
    await docker.getImage(HERMES_IMAGE).inspect();
    return;
  } catch (e) {
    // pull below
  }
  await new Promise((resolve, reject) => {
    docker.pull(HERMES_IMAGE, {}, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

// Utils
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

// Instances
async function listInstances() {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [LABEL_MANAGED] },
  });
  return containers
    .map((c) => ({
      id: c.Labels[LABEL_ID],
      name: c.Names[0].replace(/^\//, ''),
      status: c.State,
      created: c.Created * 1000,
      port: c.Labels[LABEL_PORT] || null,
    }))
    .sort((a, b) => b.created - a.created);
}

async function allocatePort() {
  const instances = await listInstances();
  const used = new Set(instances.map((i) => i.port).filter(Boolean));
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(String(p))) return p;
  }
  throw new Error('no free ports in range');
}

async function createInstance({ name, password }) {
  const id = crypto.randomBytes(3).toString('hex');
  const slug = slugify(name) || 'instance';
  const containerName = 'hermes-' + slug + '-' + id;
  await ensureImage();

  const env = [
    'HERMES_WEBUI_HOST=0.0.0.0',
    'HERMES_WEBUI_PORT=8787',
    'HERMES_WEBUI_STATE_DIR=/home/hermeswebui/.hermes/webui',
  ];
  if (password) env.push('HERMES_WEBUI_PASSWORD=' + password);
  env.push('HERMES_WEBUI_ONBOARDING_OPEN=1');
  if (BASE_DOMAIN && ACCESS_MODE === 'subdomain') {
    const host = containerName + '.' + BASE_DOMAIN;
    env.push('HERMES_WEBUI_ALLOWED_ORIGINS=http://' + host + ',https://' + host);
    env.push('HERMES_WEBUI_TRUST_FORWARDED_HOST=1');
    env.push('HERMES_WEBUI_TRUST_FORWARDED_PROTO=1');
    if (INSTANCE_URL_SCHEME === 'https') env.push('HERMES_WEBUI_SECURE=1');
  }

  const hostConfig = {
    RestartPolicy: { Name: 'unless-stopped' },
    NetworkMode: HERMES_NETWORK,
    Binds: [
      'hermes-data-' + id + ':/home/hermeswebui/.hermes',
      'hermes-ws-' + id + ':/home/hermeswebui/workspace',
    ],
  };

  const labels = {
    'hermes-manager.managed': 'true',
    [LABEL_ID]: id,
  };

  let port = null;
  if (ACCESS_MODE === 'ports') {
    port = await allocatePort();
    hostConfig.PortBindings = { '8787/tcp': [{ HostPort: String(port) }] };
    labels[LABEL_PORT] = String(port);
  }

  const config = {
    name: containerName,
    Image: HERMES_IMAGE,
    Env: env,
    Labels: labels,
    HostConfig: hostConfig,
    NetworkingConfig: {
      EndpointsConfig: { [HERMES_NETWORK]: { Aliases: [containerName] } },
    },
  };

  let container;
  try {
    container = await docker.createContainer(config);
    await container.start();
  } catch (err) {
    if (container) {
      try {
        await container.remove({ force: true });
      } catch (e) {
        // best-effort cleanup
      }
    }
    throw err;
  }

  return {
    id,
    name: containerName,
    status: 'running',
    created: Date.now(),
    port: port || null,
  };
}

async function deleteInstance(idOrName) {
  const instances = await listInstances();
  const found = instances.find((i) => i.id === idOrName || i.name === idOrName);
  if (!found) {
    const err = new Error('not found');
    err.status = 404;
    throw err;
  }
  const container = docker.getContainer(found.name);
  try {
    await container.stop({ t: 5 });
  } catch (e) {
    // ignore
  }
  await container.remove({ force: true });
  for (const v of ['hermes-data-' + found.id, 'hermes-ws-' + found.id]) {
    try {
      await docker.getVolume(v).remove({ force: true });
    } catch (e) {
      // best-effort
    }
  }
  return { ok: true };
}

// Proxy routing
function resolveAlias(req) {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (BASE_DOMAIN && host.endsWith('.' + BASE_DOMAIN)) {
    const sub = host.slice(0, host.length - BASE_DOMAIN.length - 1);
    if (sub && sub !== 'www' && !sub.includes('.')) return sub;
  }
  return null;
}

// Express app
const app = express();

// 1. Proxy middleware
app.use((req, res, next) => {
  const alias = resolveAlias(req);
  if (alias) {
    proxy.web(req, res, { target: 'http://' + alias + ':' + HERMES_INSTANCE_PORT });
    return;
  }
  next();
});

// 2. Basic auth
if (MANAGER_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const match = header.match(/^Basic\s+(.+)$/);
    if (match) {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      if (user === 'admin' && pass === MANAGER_PASSWORD) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="hermes-manager"');
    res.status(401).end();
  });
}

app.use(express.json());

// 3. List instances
app.get('/api/instances', async (req, res) => {
  try {
    const instances = await listInstances();
    res.json({ instances: instances.map((x) => ({ ...x, url: instanceUrl(x, req) })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Create instance
app.post('/api/instances', async (req, res) => {
  try {
    const { name, password } = req.body || {};
    const instance = await createInstance({ name, password });
    res.status(201).json({ instance: { ...instance, url: instanceUrl(instance, req) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete instance
app.delete('/api/instances/:id', async (req, res) => {
  try {
    const result = await deleteInstance(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: err.message });
  }
});

// 6. Static + fallback
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function instanceUrl(instance, req) {
  if (ACCESS_MODE === 'ports') {
    const host = PUBLIC_HOST || (req.headers.host || '').split(':')[0];
    return 'http://' + host + ':' + instance.port;
  }
  return INSTANCE_URL_SCHEME + '://' + instance.name + '.' + BASE_DOMAIN;
}

// 7. Listen
const server = app.listen(PORT);
server.on('upgrade', (req, socket, head) => {
  const alias = resolveAlias(req);
  if (alias) {
    proxy.ws(req, socket, head, {
      target: 'http://' + alias + ':' + HERMES_INSTANCE_PORT,
    });
  } else {
    socket.destroy();
  }
});

// Startup
(async () => {
  await ensureNetwork();
  ensureImage().catch((err) => console.error('image prefetch failed:', err.message));
  console.log(`hermes-manager listening on :${PORT} (mode=${ACCESS_MODE}, image=${HERMES_IMAGE})`);
})();