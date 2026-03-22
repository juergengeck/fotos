# Local LAN HTTPS Dev

This setup keeps everything inside the house:

- `Pi-hole` on the Synology (`schweiz`) as primary DNS for LAN clients
- `FRITZ!Box` keeps doing DHCP
- `Caddy` on the fotos dev machine (`bambam`) terminates HTTPS with a local CA
- `Vite` continues serving `fotos.browser` on `localhost:5188`

Recommended hostname scheme:

- `pihole.home.arpa`, `schweiz.home.arpa`, `synology.home.arpa` -> Synology / Pi-hole
- `fotos.home.arpa`, `bambam.home.arpa` -> bambam / fotos dev machine
- `spark.home.arpa` -> Spark host
- `fritzbox.home.arpa` -> FRITZ!Box

`home.arpa` is reserved for home networks, so it is a better fit than inventing a fake public suffix.

## Files

- [README.md](/Users/gecko/src/fotos/fotos.browser/local-dev/README.md)
- [pihole-compose.yaml](/Users/gecko/src/fotos/fotos.browser/local-dev/pihole-compose.yaml)
- [pihole.env.example](/Users/gecko/src/fotos/fotos.browser/local-dev/pihole.env.example)
- [fotos.dev-https.env.example](/Users/gecko/src/fotos/fotos.browser/local-dev/fotos.dev-https.env.example)
- [Caddyfile](/Users/gecko/src/fotos/fotos.browser/local-dev/Caddyfile)

## Network Plan

Example addresses used below:

- FRITZ!Box: `192.168.178.1`
- `schweiz` / Synology / Pi-hole: `192.168.178.121`
- `bambam` / fotos dev machine: `192.168.178.102`
- `spark` / DGX Spark host: `192.168.178.117`
- LAN CIDR: `192.168.178.0/24`

Reserve the Synology and fotos dev machine addresses in DHCP before you start.

## 1. Run Pi-hole On Synology

On the Synology:

1. Create a project folder, e.g. `/volume1/docker/pihole`.
2. Copy [pihole-compose.yaml](/Users/gecko/src/fotos/fotos.browser/local-dev/pihole-compose.yaml) into that folder as `compose.yaml`.
3. Copy [pihole.env.example](/Users/gecko/src/fotos/fotos.browser/local-dev/pihole.env.example) into that folder as `.env`.
4. Edit `.env` to match your LAN.
5. In Synology Container Manager, create a new project from that folder and start it.

Important:

- Nothing else on the Synology may already be listening on port `53`.
- If Synology DNS Server is installed on the same NAS IP, stop using it before starting Pi-hole.
- The Pi-hole web UI is intentionally mapped to `8081`, not `80`, to avoid DSM conflicts.
- On Synology, Pi-hole needs `DNSMASQ_USER=root` because the usual file capability setup is not supported there.

Open the Pi-hole UI at:

- `http://192.168.178.121:8081/admin/`
- or `http://pihole.home.arpa:8081/admin/` once DNS is live

## 2. Point FRITZ!Box DHCP Clients At Pi-hole

In FRITZ!Box:

1. Enable Advanced View.
2. Go to `Home Network -> Network -> Network Settings -> IP Addresses -> IPv4 Configuration -> Home Network`.
3. Set `Local DNS server` to the Synology / Pi-hole IP, e.g. `192.168.178.121`.
4. Leave the FRITZ!Box WAN DNS settings alone for now.

Do not set up this loop:

- FRITZ!Box upstream DNS -> Pi-hole
- Pi-hole upstream DNS -> FRITZ!Box

That will loop queries.

After saving, renew DHCP leases on clients by reconnecting Wi-Fi or toggling network off/on.

## 3. What The Pi-hole Project Already Configures

The example project sets:

- local domain: `home.arpa`
- local records for `pihole`, `schweiz`, `synology`, `fritzbox`, `bambam`, `fotos`, and `spark`
- conditional forwarding for reverse lookups to the FRITZ!Box on `fritz.box`
- `domainNeeded`, `expandHosts`, `bogusPriv`, and `localise`
- `DNSMASQ_USER=root` for Synology compatibility

That gives you:

- `fotos.home.arpa` and `bambam.home.arpa` resolving to the dev machine
- `pihole.home.arpa`, `schweiz.home.arpa`, and `synology.home.arpa` resolving to the Synology
- `spark.home.arpa` resolving to the Spark host
- short-name expansion such as `fotos`, `bambam`, `spark`, and `schweiz`
- client name lookups in Pi-hole when DHCP stays on the FRITZ!Box

## 4. Run fotos Over HTTPS On The Dev Machine

On the fotos dev machine:

1. Export the LAN HTTPS dev variables from [fotos.dev-https.env.example](/Users/gecko/src/fotos/fotos.browser/local-dev/fotos.dev-https.env.example):

```bash
set -a
source /Users/gecko/src/fotos/fotos.browser/local-dev/fotos.dev-https.env.example
set +a
```

2. Start Vite from [fotos.browser/browser-ui](/Users/gecko/src/fotos/fotos.browser/browser-ui):

```bash
pnpm dev
```

Those env vars tell Vite to:

- allow `fotos.home.arpa` and `bambam.home.arpa` as dev hosts
- advertise HMR over `wss://fotos.home.arpa:8443`

3. Install Caddy if it is not already installed.
4. Run Caddy with [Caddyfile](/Users/gecko/src/fotos/fotos.browser/local-dev/Caddyfile):

```bash
caddy run --config /Users/gecko/src/fotos/fotos.browser/local-dev/Caddyfile
```

This gives you:

- `https://fotos.home.arpa:8443` -> `http://127.0.0.1:5188`
- `https://bambam.home.arpa:8443` -> `http://127.0.0.1:5188`

The Caddy config uses `tls internal`, so Caddy becomes your house CA for this service.
The checked-in Caddyfile also uses Caddy's `skip_install_trust` option, so it will not prompt for your macOS password on startup.

## 5. Trust The Local CA On Apple Devices

Each Apple device that should use `fotos.home.arpa` in Safari needs to trust the Caddy root CA from the machine running Caddy.

Typical flow:

1. Start Caddy once so it creates the local CA.
2. Export the generated root certificate from the Caddy data directory on the dev machine.
3. Install that root certificate on each Mac/iPhone/iPad.
4. On iPhone/iPad, also enable full trust for the installed root certificate.

If you want `bambam` itself to trust the local CA automatically, run:

```bash
caddy trust
```

Without that trust step, Safari may still treat the site as certificate-invalid, which is not what we want for reliable secure-context behavior.

## 6. Verify

From any LAN client:

```bash
nslookup fotos.home.arpa 192.168.178.121
nslookup bambam.home.arpa 192.168.178.121
nslookup schweiz.home.arpa 192.168.178.121
nslookup spark.home.arpa 192.168.178.121
```

Expected answers:

- `fotos.home.arpa` and `bambam.home.arpa` -> `192.168.178.102`
- `schweiz.home.arpa` and `pihole.home.arpa` -> `192.168.178.121`
- `spark.home.arpa` -> `192.168.178.117`

Then open:

- `https://fotos.home.arpa:8443`

In Safari dev tools, these should now be true:

```js
window.isSecureContext
!!window.crypto?.subtle
```

## Notes

- If you want a clean URL later, move Caddy from `8443` to `443`.
- If you want more apps, add more lines to `FTLCONF_dns_hosts` in the Pi-hole project.
- If you later move HTTPS termination to the Synology instead of the dev machine, keep the same DNS records and shift only the Caddy endpoint.
