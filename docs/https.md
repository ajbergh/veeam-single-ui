# HTTPS and certificate management

Open Backup UI can keep using your existing HTTPS reverse proxy, or terminate TLS itself with its optional production launcher. Normal `npm start` and `npm run dev` retain their existing behavior.

## Managed HTTPS

Install dependencies and build the application, then start the HTTPS launcher:

```sh
npm ci
npm run build
npm run start:https
```

The launcher listens on port **3443** by default. It starts Next.js on a separate, ephemeral **127.0.0.1** port and forwards requests to it. Do not expose that internal HTTP port. For a copied standalone deployment/container, the launcher runs the generated `server.js`; for a regular checkout it uses the installed Next production command.

On the first start it generates a unique RSA 2048-bit self-signed server certificate, valid for 365 days, using OpenSSL 1.1.1 or later. Generation happens at runtime, never at build time, so separate installations do not share a private key. Existing certificates are retained across restarts, including uploaded certificates. An unreadable or expired saved certificate stops startup with an error instead of silently replacing your identity.

OpenSSL must be on PATH. On Windows, set `OPENSSL_BIN` to the full executable path if necessary (Git for Windows includes `usr/bin/openssl.exe`). No global TLS validation settings are changed by the launcher.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HTTPS_PORT` | `3443` | Public HTTPS listening port |
| `HTTPS_BIND` | `0.0.0.0` | Listening interface; use `127.0.0.1` for local testing |
| `HTTPS_HOSTNAMES` | Localhost, loopback IPs, machine hostname | Extra comma-separated DNS names/IPs for the first self-signed certificate |
| `HTTPS_DATA_DIR` | `data/tls` beneath the working directory | Private persistent certificate directory |
| `HTTPS_ADMIN_TOKEN` | Unset; uploads disabled | Dedicated 32–512-character secret authorizing certificate replacement |
| `OPENSSL_BIN` | `openssl` | OpenSSL executable path for initial generation |

Set `HTTPS_HOSTNAMES` before the first start, for example `backup.example.com,192.0.2.10`. Changing it later does not overwrite an existing certificate. Use a certificate covering the DNS name you will actually open.

The runtime also accepts `OPEN_BACKUP_HTTPS_*` environment variables internally between its parent and Next process. Do not configure these yourself or forward those headers from an external proxy.

## Install your own certificate

1. Configure `HTTPS_ADMIN_TOKEN` in the server environment and start the managed HTTPS launcher. A cryptographically random token can be generated with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store it as a deployment secret, not in Git.
2. Open the application through its managed **HTTPS** address and go to **Administration → Settings → HTTPS**.
3. Select the PEM server certificate (or leaf-first full chain), its matching unencrypted PEM private key, and optionally a separate PEM intermediate/CA chain.
4. Enter the dedicated HTTPS administration token and apply the certificate.

The server validates the key match, current validity dates, server-authentication purpose, SAN hostname match, and signatures/order of every supplied issuer certificate. A separate chain must start with the issuer of the last certificate in the server certificate file; do not upload duplicate certificates. RSA keys must be at least 2048 bits. PEM certificate and chain files are limited to 64 KiB each, keys to 32 KiB, and the complete JSON request to 256 KiB. Password-protected keys, PFX/P12 containers, and file paths are not accepted.

The certificate must cover the hostname used to open Settings. When migrating to a different hostname, use a certificate covering both names first, or install the replacement offline before switching the deployment address.

Replacement is applied to the live TLS listener with `setSecureContext`; new connections receive the new certificate while existing requests continue. **No application restart is needed.** The old certificate remains active if validation, staging, or persistence fails. Private keys are never returned by the settings API. Only public certificate metadata is shown.

The optional CA field supplies the **server's presented certificate chain**. It does not install trust into clients or change the CA trust used for outbound connections to Veeam. A self-signed/private-CA certificate is trusted only when that CA/certificate is trusted by each client; uploading a CA to the server cannot make browsers trust it. For public browser trust, obtain a certificate from a public CA for your DNS name, or terminate TLS at an existing reverse proxy with automated issuance/renewal.

## Data protection and deployment

- Persist the TLS directory independently of image builds. It contains the private key in `certificate.json` and must never be placed in `public/`, committed, or included in release archives. The repository already excludes `data/`.
- The application creates directories with mode `0700` and files with mode `0600` on POSIX systems. On Windows, restrict NTFS ACLs to the account running the application and administrators; Node's POSIX mode flags do not enforce Windows ACLs. Use an appropriately protected volume in containers.
- Certificate upload uses a dedicated token because the application does not yet have a separate application-administrator login. The token is not a Veeam credential. Keep your existing network/access controls: enabling HTTPS does not add application authentication.
- An existing Caddy/nginx/IIS/Cloudflare TLS deployment remains fully supported. Run the app normally behind it and manage certificates there. The in-app certificate panel reports external management and disables upload in that mode.
- To recover offline, stop the managed launcher and restore a known-good `data/tls/certificate.json` backup. For a disposable self-signed installation only, move the existing file to a protected backup location and restart to generate a new identity. Do not delete your only copy of a production key.

Implementation references: [Node TLS context replacement](https://nodejs.org/api/tls.html#serversetsecurecontextoptions), [Node X.509 certificate validation](https://nodejs.org/api/crypto.html#class-x509certificate), and [Next.js standalone deployment](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
