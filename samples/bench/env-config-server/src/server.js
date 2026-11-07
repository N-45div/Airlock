const http = require('node:http');
const { loadConfig } = require('./config.js');

const config = loadConfig();
http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`${config.GREETING}\n`);
  })
  .listen(Number(config.PORT), '127.0.0.1', () => console.log(`Listening on http://localhost:${config.PORT}`));
