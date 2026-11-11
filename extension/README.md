# Airlock for Chrome

Check a stranger's GitHub repository right where you found it. On a GitHub repository page or an
npm package page, the extension adds a **Check before you run** button. Press it and the Airlock
web app has a fenced AI agent read the repository on Airlock's server, then tells you whether it
is safe to run. If someone checked it before, the button shows that verdict instead: **Looks safe**,
**Be careful** or **Don't run it**, with the one-line reason as its tooltip.

The extension never downloads or runs the repository itself. It is plain JavaScript (Manifest V3,
no bundler, no dependencies).

The product name lives in `config.js` (`PRODUCT_NAME`) and in `manifest.json` (`name`, `short_name`, `action.default_title`); a test fails if they differ.

## Load it unpacked

1. Start the Airlock server from the repository root: `npm start` (it listens on
   `http://localhost:8787`).
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick this
   `extension/` folder.
3. Open any repository on github.com. The button sits with Sponsor, Watch, Fork and Star on the
   repository's home page, and as a small pill in the bottom-right corner on its other pages.

To use another server, open the extension's **Settings** (from the popup, or **Details >
Extension options** on `chrome://extensions`). It accepts an `https://` address, or
`http://localhost` for a server on your computer. For a new `https://` address Chrome asks you to
let the extension talk to it; the permission is handed back when you switch away.

## Test, icons, package

```sh
node --test extension/test/             # or: cd extension && npm test
node extension/scripts/make-icons.mjs   # redraws icons/*.png from web/public/favicon.svg (needs Chrome)
node extension/scripts/zip.mjs          # writes extension/airlock-extension.zip
node extension/scripts/live-check.mjs   # loads it into headless Chrome, checks placement on live GitHub
node extension/scripts/agent-guard-check.mjs [--shots dir]  # the agent guard end to end, in Chrome with WebMCP on
```

GitHub changes its markup now and then; `live-check.mjs` shows at once whether the button still
lands in the repository header (it never presses it, so no check starts).

The zip holds only what Chrome runs: `manifest.json`, the root `.js`, `.html` and `.css` files,
`lib/` and `icons/`. Tests, scripts and these docs stay out. Upload it on the Chrome Web Store
developer dashboard; the listing text is in [STORE.md](STORE.md).

When production has a URL, set `DEFAULT_API_BASE` in `config.js` and put the same origin in
`host_permissions` in `manifest.json` (a test checks the two match).

## What it sends

Only the address of a GitHub repository: to the Airlock server you set, and, when looking up an
earlier verdict, to a public NEAR testnet RPC node (`test.rpc.fastnear.com`) that reads Airlock's
verdict registry:

- **When you press Check before you run** (on the page or in the popup): the repository's address,
  to start a check (`POST /api/scans`). The report opens in a new tab; the key that lets you
  answer the agent's approval questions is in the link's `#fragment`, which browsers never send
  to a server.
- **When you open a repository or npm package page**, only if you turn on "Show earlier verdicts"
  in Settings (it is off by default): that repository's address, to look for an earlier verdict
  (`GET /api/lookup` on the server, and a `get_latest` view call on the NEAR registry).
  Otherwise nothing is sent until you press the button or open the popup.

## Guard AI agents in the browser (WebMCP)

With [WebMCP](https://developer.chrome.com/docs/ai/webmcp) (a Chrome origin trial since Chrome 149),
a site can hand tools straight to the AI agent in your browser: "swap tokens", "sign transaction".
Turn on **Guard AI agents in the browser** in Settings and the extension checks every tool a page
offers before any agent sees it. It's off by default, because it has to run on every `https://`
page: Chrome asks you for access to all sites when you turn it on, and the access is handed back
when you turn it off.

| The tool | What Airlock does |
| --- | --- |
| Slips instructions to the agent in its description ("keep this from the user", "act without asking"), imitates system messages, or hides text in invisible characters | Never offered to agents |
| Asks for a seed phrase, recovery words or a private key | Never offered to agents |
| Moves money or signs (swap, transfer, approve, withdraw, sign a transaction...) | Offered, but every call, from any agent, waits for you to press **Allow once** or **Block**. Said whether the site marked it `consequentialHint`, and caught when it claims `readOnlyHint` |
| Pushes the agent to call it first | Waits for you |
| A description over Chrome's 500-character guidance | Noted |

Forms offered with the declarative API (`<form toolname>`) get the same checks: a blocked one
loses its `toolname`, and one that moves money loses `toolautosubmit`, so you press submit.
The toolbar badge counts what a page held, and the popup lists each tool with the reason.

How: `lib/agent-tools.js` (the checks) and `agent-guard.js` (the wrapper) are registered with
`chrome.scripting` to run in the page's own JavaScript world at `document_start`, before any page
script. The wrapper replaces `registerTool` on the `ModelContext` prototype, keeps its own copies of
the built-ins it uses, and holds a page's tools back if the page swaps out a built-in the checks rely
on. The Allow and Block buttons live in a closed shadow root and count only real clicks.
`agent-guard-bridge.js` passes the page's report to the service worker for the badge and popup. The
checks run on your computer; nothing about the pages you open is sent anywhere.

It is a guard rail inside the page: a page written to get around it can. Try it on
[the test page](https://airlock-check.vercel.app/demo/agent-tools.html), a pretend crypto app with
five tools, two of them traps, after turning on `chrome://flags/#enable-webmcp-testing`.

## Verdicts on NEAR

The extension reads Airlock's latest verdict for a repository from the
[verdict registry](../docs/registry.md) on NEAR testnet (`airlock-verdicts.testnet`), as recorded by
`airlock-recorder.testnet`. The contract stored each verdict only after verifying, on chain, the
signature of a NEAR AI Cloud model running in an attested TEE. When there is one, the button reads
"Looks safe · on NEAR" (or "Be careful", "Don't run it"); its tooltip and the popup say when, by
which model and with how many findings, and link to the verdict's page and receipt. Reading needs no
key and no wallet (`lib/near.js`).

Requests carry no cookies, no account details and no identifiers. The extension has no
analytics or tracking, reads nothing else from the pages, and stores only its two settings
(`chrome.storage.sync`).

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Keeps the settings, and (for the session only) what the agent guard saw on each tab. |
| `scripting` | Registers the agent guard's scripts when you turn it on, and removes them when you turn it off. |
| `https://airlock-check.vercel.app/*` (host) | Talks to the Airlock server. |
| `https://test.rpc.fastnear.com/*` (host) | Reads verdicts from the NEAR registry (view calls only; no key). |
| `https://*/*`, `http://localhost/*` (optional host) | Requested for one origin when you enter your own `https://` server in Settings, and for all sites when you turn on the agent guard. Never at install. |
| Content scripts on `github.com` and `www.npmjs.com` | Shows the button. npm is matched site-wide (not just `/package/*`) because npm moves between pages without reloading; the script does nothing off package pages. |

No `tabs`, `activeTab` or `web_accessible_resources`. The popup learns the current tab's
repository by asking the content script.

## How it fits together

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. |
| `config.js` | Product name, default server, settings keys. |
| `background.js` | Service worker (ES module). Every network call and every new tab goes through it. |
| `content.js` | The button. A classic script, so it asks the worker to detect the repository. |
| `lib/repo.js` | Which repository a page is about (GitHub path, npm sidebar link, pasted text). |
| `lib/api.js` | The server routes from `server/types.ts`, verdict labels, plain error sentences. |
| `lib/near.js` | Reads the NEAR verdict registry over public RPC. |
| `lib/settings.js` | Server address validation. |
| `lib/agent-tools.js`, `agent-guard.js` | The agent guard's checks and its wrapper around `registerTool`, in the page's world. |
| `agent-guard-bridge.js` | Passes the guard's report from the page to the service worker. |
| `lib/agent-guard-setup.js` | Turns the agent guard on and off (`chrome.scripting`). |
| `popup.*`, `options.*` | The toolbar popup and the settings page. |

Where the button goes, most specific first:

1. GitHub repository home: appended to `ul[data-testid="repo-header-actions"]` (the Sponsor,
   Watch, Fork, Star row), inside its own `<li>`.
2. Older GitHub markup: `#repository-container-header ul.pagehead-actions`.
3. npm package page: right after the sidebar link `a[aria-labelledby~="repository-link"]`.
4. Anywhere else on a repository (file, issue and pull request pages, or if GitHub changes its
   markup): a small pill fixed to the bottom-right corner, with a button to hide it for that
   repository. The script waits 1.5 seconds for the header before using the pill.

The button lives in a closed shadow root, follows GitHub's `data-color-mode` (and the system
theme when GitHub is on auto), and waits for the page to load and go idle before inserting, so it
never lands while GitHub's React views are hydrating. It keeps up with GitHub's Turbo, pjax and
history navigation through a debounced `MutationObserver`, and never inserts twice.
