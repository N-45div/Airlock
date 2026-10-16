# Chrome Web Store listing (draft)

## Basics

- **Name:** Airlock
- **Category:** Developer Tools
- **Language:** English
- **Summary (132 characters max, same as the manifest description):**
  Check a stranger's GitHub repository before you run it. A fenced AI agent reads it first and tells you if it is safe.

## Single purpose

Airlock helps you decide whether a GitHub repository is safe to run before you clone or install
it. It adds one button to GitHub repository pages and npm package pages that sends that
repository's address to the Airlock service for a check, and shows the result.

## Short description

Before you run a stranger's code, let a fenced AI agent open it first. One button on GitHub and
npm gives you a plain answer: Looks safe, Be careful, or Don't run it.

## Long description

Someone sends you a take-home task. A free trading bot promises easy returns. A starter kit asks
you to run npm install. Any of them can run code on your computer the moment you install or open
it, and read your SSH keys, browser data or crypto wallets.

Airlock checks the repository first, without it ever touching your computer.

How it works:
1. On a GitHub repository or an npm package page, press Check before you run.
2. Airlock copies the repository onto its own server. An AI agent reads it inside a fence: it can
   look, but anything that could do harm is blocked or held for you to approve.
3. You get a plain answer, with the reasons and the exact files, in a report you can share.

If someone already checked that repository, the button shows the verdict straight away.

What Airlock looks for:
- Scripts that run on install, or when you open the folder in your editor
- Code that reads SSH keys, .env files, browser profiles or cloud credentials
- Crypto wallet access and clipboard address swapping
- Data sent out to Telegram bots, Discord webhooks, paste sites or bare IP addresses
- Packed or encoded code, and programs shipped inside the repository
- Text planted to steer AI coding assistants

Private by design: the extension sends only the address of a repository. No account, no
cookies, no tracking. Nothing is sent until you press the button (you can turn on showing
earlier verdicts automatically in Settings).

Free to use.

## Permission justifications

- **storage:** Saves two settings: the address of the Airlock server and whether repository
  pages look up earlier verdicts.
- **Host permission for the Airlock server** (`https://airlock-check.vercel.app/*`): The extension's service worker calls the Airlock API to
  start a check and to look up an earlier verdict for a repository.
- **Optional host permissions `https://*/*` and `http://localhost/*`:** Never granted at install. Requested for a single
  origin only when the user types their own Airlock server address in Settings, so the
  extension can reach that server. Handed back when the user switches away.
- **Content scripts on github.com and www.npmjs.com:** Add the Check before you run button to
  repository and package pages and read which repository the page is about (from the address on
  GitHub, from the sidebar Repository link on npm). Nothing else on the page is read or changed.

## Remote code

No. All JavaScript ships in the package. The extension only exchanges JSON with the Airlock API.

## Data use disclosures

What the extension sends, and when:
- The address of a GitHub repository the user chooses to check, when they press the button.
- Only if the user turns on the "Show earlier verdicts" setting (off by default), the address of the GitHub
  repository on the GitHub or npm page the user opens, to look up an earlier verdict.

Dashboard answers:
- Personally identifiable information, health, financial and payment, authentication,
  personal communications, location, user activity: **not collected**.
- Website content: **not collected** (the extension reads only a link from the page, not its
  content).
- Web history: **not collected** by default. Only if the user turns on "Show earlier verdicts"
  in Settings are the addresses of GitHub repository pages they open sent, to look up an
  earlier verdict.

Certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** required because repository addresses are sent; publish one on the web
app (for example `/privacy`) before submitting.

## Assets to prepare

- Icon: `icons/icon-128.png` (in the package).
- Screenshots, 1280x800: the button on a repository's GitHub page; a "Don't run it" verdict with
  its tooltip; the report page; the popup on a repository.
- Small promo tile, 440x280 (optional).
