#!/usr/bin/env node
// Looks up a city with Open-Meteo's geocoding API, then prints its current temperature.
const city = process.argv.slice(2).join(' ') || 'Lisbon';

async function main() {
  const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`).then((r) => r.json());
  const place = geo.results?.[0];
  if (!place) {
    console.error(`No place called ${city}.`);
    process.exit(1);
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m`;
  const weather = await fetch(url).then((r) => r.json());
  console.log(`${place.name}: ${weather.current.temperature_2m}°C`);
}

main();
