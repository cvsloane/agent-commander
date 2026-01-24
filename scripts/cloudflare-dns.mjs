const apiToken = process.env.CF_API_TOKEN;
const zoneId = process.env.CF_ZONE_ID;
const baseDomain = process.env.CF_BASE_DOMAIN || 'agentcommander.co';
const targetIp = process.env.CF_TARGET_IP;
const targetIpv6 = process.env.CF_TARGET_IPV6 || '';
const proxied = (process.env.CF_PROXIED || 'true').toLowerCase() === 'true';
const includeApex = (process.env.CF_INCLUDE_APEX || 'true').toLowerCase() === 'true';
const subdomains = (process.env.CF_SUBDOMAINS || 'app,api,docs').split(',').map(s => s.trim()).filter(Boolean);

if (!apiToken || !zoneId || !targetIp) {
  console.error('Missing CF_API_TOKEN, CF_ZONE_ID, or CF_TARGET_IP');
  process.exit(1);
}

const apiBase = 'https://api.cloudflare.com/client/v4';

const headers = {
  Authorization: `Bearer ${apiToken}`,
  'Content-Type': 'application/json',
};

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const json = await res.json();
  if (!json.success) {
    const message = json.errors?.map((e) => e.message).join('; ') || 'Unknown error';
    throw new Error(message);
  }
  return json;
}

async function upsertRecord(name, type, content) {
  const listUrl = `${apiBase}/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(name)}`;
  const list = await fetchJson(listUrl, { method: 'GET' });
  const existing = list.result?.[0];

  const payload = {
    type,
    name,
    content,
    ttl: 1,
    proxied,
  };

  if (existing) {
    const updateUrl = `${apiBase}/zones/${zoneId}/dns_records/${existing.id}`;
    await fetchJson(updateUrl, { method: 'PUT', body: JSON.stringify(payload) });
    console.log(`Updated ${type} ${name} -> ${content}`);
    return;
  }

  const createUrl = `${apiBase}/zones/${zoneId}/dns_records`;
  await fetchJson(createUrl, { method: 'POST', body: JSON.stringify(payload) });
  console.log(`Created ${type} ${name} -> ${content}`);
}

async function run() {
  const records = [];
  if (includeApex) {
    records.push(baseDomain);
  }
  for (const sub of subdomains) {
    records.push(`${sub}.${baseDomain}`);
  }

  for (const name of records) {
    await upsertRecord(name, 'A', targetIp);
    if (targetIpv6) {
      await upsertRecord(name, 'AAAA', targetIpv6);
    }
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
