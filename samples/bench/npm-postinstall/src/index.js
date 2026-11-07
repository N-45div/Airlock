const color = (code) => (text) => console.log(`\u001b[${code}m${text}\u001b[0m`);
module.exports = { info: color(34), warn: color(33), error: color(31) };
