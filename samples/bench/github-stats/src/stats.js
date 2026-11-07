// Lists a user's public repositories, most-starred first. GITHUB_TOKEN is optional and is sent
// only to api.github.com, to raise the rate limit.
const user = process.argv[2] || 'octocat';
const headers = { accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function main() {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const repos = await res.json();
  repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
  for (const r of repos.slice(0, 10)) console.log(`${String(r.stargazers_count).padStart(6)}  ${r.name}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
