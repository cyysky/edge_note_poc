/**
 * TLS front door for the LAN.
 *
 * Android Chrome only exposes the camera and microphone in a secure context,
 * and no public CA issues a certificate for a private address. This process
 * terminates TLS with the leaf that scripts/https-cert.ps1 issued and forwards
 * every request to the plain-HTTP Next server, so the app keeps one build and
 * its /api rewrite keeps pointing at 3001.
 *
 * Run through scripts/https-serve.ps1; arguments are target URL, port, cert, key.
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';

const [targetArg, portArg, certPath, keyPath] = process.argv.slice(2);
if (!targetArg || !portArg || !certPath || !keyPath) {
  console.error('usage: https-proxy.mjs <target-url> <port> <cert> <key>');
  process.exit(2);
}

const target = new URL(targetArg);
const port = Number(portArg);
const cert = readFileSync(certPath);
const key = readFileSync(keyPath);

const server = createServer({ key, cert }, (req, res) => {
  // The upstream is the local Next server, which serves exactly one origin; the
  // browser's own Host header is forwarded so absolute URLs stay on the name the
  // phone dialled rather than the loopback address.
  const forwarded = request(
    {
      host: target.hostname,
      port: Number(target.port || 80),
      method: req.method,
      path: req.url,
      headers: { ...req.headers, 'x-forwarded-proto': 'https' },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );

  forwarded.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      'The web app is not answering at ' +
        target.href +
        ' (' +
        error.message +
        '). Start it with scripts/run-web.ps1, then reload.',
    );
  });

  req.pipe(forwarded);
});

server.on('tlsClientError', (error) => {
  // A browser that has not installed the CA lands here; naming it saves the
  // guesswork that "server unavailable" would otherwise cause.
  console.error('TLS handshake failed: ' + error.message);
});

server.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  console.log('HTTPS proxy listening on port ' + port + ' -> ' + target.href);
  console.log('Open the LAN address from the phone, not localhost.');
});
