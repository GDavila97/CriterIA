// Stands in for github.com and api.github.com: the web server's calls are routed here in tests.
// The authorization code chooses the profile, so each test controls who "GitHub" returns.
import { createServer } from 'node:http';

import { PORTS } from './env.mjs';

const profiles = new Map();

function profileFor(code) {
  // code = "<id>.<email>.<verified>" with the email base64url-encoded.
  const [id, email, verified] = code.split('.');
  return {
    id: Number(id),
    login: `user${id}`,
    name: `GitHub ${id}`,
    email: Buffer.from(email, 'base64url').toString(),
    verified: verified === '1',
  };
}

function json(response, body) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

createServer((request, response) => {
  const url = new URL(request.url, 'http://stub');
  if (url.pathname === '/health') {
    response.writeHead(200).end('ok');
    return;
  }
  if (request.method === 'POST' && url.pathname === '/github.com/login/oauth/access_token') {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const code = new URLSearchParams(body).get('code') ?? JSON.parse(body || '{}').code;
      const token = `stub-${Math.random().toString(36).slice(2)}`;
      profiles.set(token, profileFor(code));
      json(response, { access_token: token, token_type: 'bearer', scope: 'user:email' });
    });
    return;
  }
  const token = (request.headers.authorization ?? '').replace(/^Bearer /i, '');
  const profile = profiles.get(token);
  if (!profile) {
    response.writeHead(401).end();
    return;
  }
  if (url.pathname === '/api.github.com/user') {
    json(response, {
      id: profile.id,
      login: profile.login,
      name: profile.name,
      email: null,
      avatar_url: '',
    });
    return;
  }
  if (url.pathname === '/api.github.com/user/emails') {
    json(response, [
      { email: profile.email, primary: true, verified: profile.verified, visibility: 'private' },
    ]);
    return;
  }
  response.writeHead(404).end();
}).listen(PORTS.githubStub, '127.0.0.1', () => console.log(`GitHub stub on ${PORTS.githubStub}`));
