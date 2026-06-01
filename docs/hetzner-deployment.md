# WattPatch Domain and Hetzner Deployment Guide

This guide assumes the production domain is `wattpatch.co.uk` and the app is deployed on a small Hetzner Cloud VPS. Replace the domain if you register a different variant.

## 1. Buy the domain

1. Register `wattpatch.co.uk` with your preferred registrar.
   - Good low-friction options: Cloudflare Registrar, Porkbun, Namecheap, or 123 Reg.
   - If available at checkout, also buy `wattpatch.uk`, `wattpatch.com`, and `wattpatch.app` defensively.
2. Use Cloudflare for DNS if possible:
   - Either buy the domain through Cloudflare, or
   - Change the domain nameservers at the registrar to the two Cloudflare nameservers Cloudflare gives you.
3. Keep DNS records empty until the Hetzner server has a public IPv4 address.

## 2. Create the Hetzner server

1. Open Hetzner Cloud Console.
2. Create a new project, for example `wattpatch`.
3. Add your SSH key under **Security → SSH Keys** if it is not already there.
4. Create a server:
   - Location: closest sensible EU region, e.g. Nuremberg or Falkenstein.
   - Image: Ubuntu 24.04 LTS.
   - Type: CX22 or the cheapest shared vCPU instance is enough to start.
   - Networking: enable IPv4; IPv6 optional.
   - SSH key: select your key.
   - Name: `wattpatch-web-01`.
5. Copy the public IPv4 address.

## 3. Point DNS at Hetzner

In Cloudflare DNS, add:

```text
Type  Name  Content              Proxy
A     @     <HETZNER_IPV4>       DNS only initially
A     www   <HETZNER_IPV4>       DNS only initially
```

If you enabled IPv6 on Hetzner, also add AAAA records for `@` and `www`.

Leave records as **DNS only** until Caddy has issued the first TLS certificate. After it works, Cloudflare proxy can be enabled if desired.

## 4. Initial server setup

SSH into the server:

```bash
ssh root@<HETZNER_IPV4>
```

Create a deploy user:

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy/
```

Log back in as deploy:

```bash
ssh deploy@<HETZNER_IPV4>
```

Install runtime packages:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
```

Install Node.js 22 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Enable the firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

## 5. Give the server read-only GitHub access

From the server, generate a deploy key:

```bash
ssh-keygen -t ed25519 -C "wattpatch-deploy" -f ~/.ssh/wattpatch_deploy -N ""
cat ~/.ssh/wattpatch_deploy.pub
```

In GitHub:

1. Go to `Ghollis34/plug_in_solar`.
2. Open **Settings → Deploy keys → Add deploy key**.
3. Title: `wattpatch-web-01`.
4. Paste the public key.
5. Leave **Allow write access** unchecked.

Add an SSH host alias on the server:

```bash
cat > ~/.ssh/config <<'EOF'
Host github-wattpatch
  HostName github.com
  User git
  IdentityFile ~/.ssh/wattpatch_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T github-wattpatch || true
```

## 6. Build and install WattPatch

```bash
sudo mkdir -p /var/www/wattpatch /var/lib/wattpatch
sudo chown -R deploy:deploy /var/www/wattpatch /var/lib/wattpatch

git clone git@github-wattpatch:Ghollis34/plug_in_solar.git /var/www/wattpatch/current
cd /var/www/wattpatch/current
npm ci
npm run build
```

Set production referral URLs in `src/data/config.json` before building if they are still empty:

```json
{
  "referralRedirectBaseUrl": "https://wattpatch.co.uk/r",
  "referralTrackingEndpoint": "https://wattpatch.co.uk/api/referral-clicks"
}
```

Then rebuild:

```bash
npm run build
```

## 7. Run the referral server with systemd

Create the service:

```bash
sudo tee /etc/systemd/system/wattpatch-referral.service >/dev/null <<'EOF'
[Unit]
Description=WattPatch referral redirect and click tracking server
After=network.target

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/var/www/wattpatch/current
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=WATTPATCH_ROOT=/var/www/wattpatch/current
Environment=REFERRAL_LOG_FILE=/var/lib/wattpatch/referral-clicks.jsonl
ExecStart=/usr/bin/npm run referral-server
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/wattpatch

[Install]
WantedBy=multi-user.target
EOF
```

Start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wattpatch-referral
sudo systemctl status wattpatch-referral --no-pager
curl -s http://127.0.0.1:8787/health
```

Expected health response:

```json
{"ok":true}
```

## 8. Configure Caddy

Create `/etc/caddy/Caddyfile`:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
wattpatch.co.uk {
  root * /var/www/wattpatch/current/dist
  encode gzip zstd

  reverse_proxy /r/* 127.0.0.1:8787
  reverse_proxy /api/referral-clicks 127.0.0.1:8787
  reverse_proxy /api/referrals/summary 127.0.0.1:8787
  reverse_proxy /health 127.0.0.1:8787

  try_files {path} /index.html
  file_server
}

www.wattpatch.co.uk {
  redir https://wattpatch.co.uk{uri} permanent
}
EOF
```

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Check production:

```bash
curl -I https://wattpatch.co.uk
curl -s https://wattpatch.co.uk/health
curl -s https://wattpatch.co.uk/api/referrals/summary
```

## 9. Deploy updates later

For each release:

```bash
ssh deploy@<HETZNER_IPV4>
cd /var/www/wattpatch/current
git fetch --prune origin
git checkout main
git reset --hard origin/main
npm ci
npm test
npm run build
sudo systemctl restart wattpatch-referral
curl -I https://wattpatch.co.uk
curl -s https://wattpatch.co.uk/health
```

## 10. Post-launch checks

- Confirm the homepage title says `WattPatch`.
- Run through a quote flow on mobile and desktop.
- Click one retailer CTA and confirm the referral summary count changes:

```bash
curl -s https://wattpatch.co.uk/api/referrals/summary
```

- Once TLS works, optionally switch Cloudflare DNS records from **DNS only** to **Proxied**.
- If Cloudflare proxy is enabled, set SSL/TLS mode to **Full (strict)**.
