// Reads KEY=value lines from this project's own .env file, if there is one.
const fs = require('node:fs');
const path = require('node:path');

function loadConfig() {
  const file = path.join(__dirname, '..', '.env');
  const config = { PORT: '3000', GREETING: 'Hello' };
  if (!fs.existsSync(file)) return config;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) config[match[1]] = match[2];
  }
  return config;
}

module.exports = { loadConfig };
