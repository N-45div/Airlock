// Checks the tools a web page offers to AI agents through WebMCP
// (document.modelContext.registerTool, or a <form toolname> in the page), before an agent sees them.
// A classic script: it runs inside the page, ahead of the page's own scripts, as part of the agent
// guard (agent-guard.js takes the API from the global below and then removes it). node --test
// loads it with node:vm. Nothing here talks to the network.
//
// Each tool gets a level:
//   block  never shown to agents: it carries instructions aimed at the agent, or asks for a seed
//          phrase or private key
//   ask    shown, but every call waits for the person: it moves money or signs something
//   note   shown; worth knowing (an oversized description)
//   ok     nothing found

(function (root) {
  'use strict';

  /** Chrome's WebMCP security guidance suggests at most 500 characters per tool description. */
  const DESCRIPTION_BUDGET = 500;
  const LEVELS = ['ok', 'note', 'ask', 'block'];

  // Text that steers the agent instead of describing the tool. Each pattern is written so the
  // phrase it looks for doesn't appear in this file as plain text.
  const STEERING = [
    { re: /\bignore\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|other|system)\s+(?:instructions|rules|prompts?|guidelines)\b/i, text: 'tells the agent to ignore its instructions' },
    { re: /\b(?:do\s+not|don'?t|never)\s+(?:tell|inform|show|mention|alert|notify|warn|ask)\s+(?:the\s+|your\s+)?(?:user|person|human|owner)\b/i, text: 'tells the agent to keep something from you' },
    { re: /\bwithout\s+(?:asking|telling|confirming(?:\s+with)?|notifying|checking\s+with|the\s+consent\s+of)\s+(?:the\s+|your\s+)?(?:user|person|human|owner)\b/i, text: 'tells the agent to act without asking you' },
    { re: /\b(?:system\s+prompt|developer\s+message|new\s+instructions\s*:)|<\|(?:im_start|system)\|>|\[\s*system\s*\]/i, text: 'imitates instructions from the agent\'s own system' },
    { re: /\bsilently\s+(?:call|run|send|sign|approve|transfer)\b/i, text: 'asks the agent to do something quietly' },
  ];
  // Pushy but not hidden: worth a question, not a block.
  const PUSHY = [
    { re: /\b(?:always|must|first)\s+(?:call|use|run)\s+this\s+tool\b|\bcall\s+this\s+tool\s+(?:first|before\s+(?:any|every|all))\b/i, text: 'pushes the agent to call it before anything else' },
  ];
  // Characters people can't see: zero-width, direction overrides, and Unicode tag characters.
  const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|\uDB40[\uDC00-\uDC7F]/;

  // A seed phrase or private key is never something a site needs an agent to type in.
  const SECRET = /\b(?:seed|mnemonic|recovery|secret|backup)[\s_-]*(?:phrase|words?|key)\b|\bmnemonic\b|\bprivate[\s_-]*keys?\b|\bpriv[\s_-]*key\b|\bsecret[\s_-]*key\b|\bkeystore\b|\bwallet[\s_-]*password\b|\b(?:12|twelve|24|twenty[\s-]*four)[\s-]*words?\b/i;

  // Verbs that move money on their own, and verbs that need a money word nearby.
  const MONEY_VERBS = /\b(?:swap|withdraw|bridge|stake|unstake|purchase|checkout|pay|payout|mint|borrow|repay|liquidate)\b/i;
  const CONTEXT_VERBS = /\b(?:send|transfer|approve|sign|deposit|buy|sell|delegate|spend|permit)\b/i;
  const MONEY_WORDS = /\b(?:tokens?|funds?|coins?|crypto|eth|ether|btc|bitcoin|sol|near|usdc|usdt|dai|nfts?|wallet|transactions?|tx|payments?|amount|balance|allowance|gas|wei|lamports|yocto|card|invoice|money|dollars?|usd)\b/i;
  const SIGNING = /\bsign(?:s|ing)?\b(?!\s+(?:up|in|out|on)\b)[\s\S]{0,40}\b(?:transactions?|tx|messages?|typed\s*data|permit|payload|delegations?)\b/i;

  function words(name) {
    return String(name ?? '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-.:/]+/g, ' ')
      .toLowerCase();
  }

  /** Every piece of text in an input schema an agent would read: property names, titles,
   * descriptions and enum values. Capped, since a page controls the schema. */
  function schemaText(schema, out = [], depth = 0) {
    if (!schema || typeof schema !== 'object' || depth > 6 || out.length > 400) return out;
    for (const key of ['title', 'description']) if (typeof schema[key] === 'string') out.push(schema[key]);
    if (Array.isArray(schema.enum)) for (const v of schema.enum.slice(0, 50)) if (typeof v === 'string') out.push(v);
    if (typeof schema.const === 'string') out.push(schema.const);
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [name, sub] of Object.entries(schema.properties).slice(0, 100)) {
        out.push(words(name));
        schemaText(sub, out, depth + 1);
      }
    }
    for (const key of ['items', 'additionalProperties']) if (schema[key] && typeof schema[key] === 'object') schemaText(schema[key], out, depth + 1);
    for (const key of ['oneOf', 'anyOf', 'allOf']) if (Array.isArray(schema[key])) for (const sub of schema[key].slice(0, 20)) schemaText(sub, out, depth + 1);
    return out;
  }

  function propertyNames(schema) {
    const props = schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    return Object.keys(props).slice(0, 100).map(words);
  }

  /** Reads a tool once into plain data. `tool` is what the page passed to registerTool (or built
   * from a form); getters run once here, and the guard only ever uses this copy. */
  function describeTool(tool) {
    const t = tool && typeof tool === 'object' ? tool : {};
    let schema = t.inputSchema;
    if (typeof schema === 'string') {
      try {
        schema = JSON.parse(schema);
      } catch {
        schema = {};
      }
    }
    const a = t.annotations && typeof t.annotations === 'object' ? t.annotations : {};
    return {
      name: String(t.name ?? '').slice(0, 200),
      title: String(t.title ?? '').slice(0, 200),
      description: String(t.description ?? '').slice(0, 20_000),
      inputSchema: schema && typeof schema === 'object' ? schema : {},
      annotations: {
        readOnlyHint: a.readOnlyHint === true,
        consequentialHint: a.consequentialHint === true,
        untrustedContentHint: a.untrustedContentHint === true,
      },
    };
  }

  function worst(levels) {
    return levels.reduce((w, l) => (LEVELS.indexOf(l) > LEVELS.indexOf(w) ? l : w), 'ok');
  }

  /** The verdict for one tool: { level, reasons: [{ level, code, text }] }. */
  function checkTool(meta) {
    const m = meta && meta.annotations ? meta : describeTool(meta);
    const reasons = [];
    const add = (level, code, text) => {
      if (!reasons.some((r) => r.code === code)) reasons.push({ level, code, text });
    };
    const schemaBits = schemaText(m.inputSchema);
    const prose = [m.title, m.description, ...schemaBits].join('\n');
    const all = [words(m.name), prose].join('\n');

    for (const { re, text } of STEERING) if (re.test(prose)) add('block', 'steers-agent', `Its description ${text}.`);
    if (INVISIBLE.test(all)) add('block', 'hidden-text', 'It hides text in characters you can\'t see.');
    for (const { re, text } of PUSHY) if (re.test(prose)) add('ask', 'pushy', `Its description ${text}.`);

    const secretIn = [...propertyNames(m.inputSchema), ...schemaBits, m.description].find((s) => SECRET.test(s));
    if (secretIn !== undefined) add('block', 'asks-secret', 'It asks for a seed phrase or private key. No honest site needs an agent to type those in.');

    const nameWords = words(m.name);
    const head = `${nameWords}\n${m.title}`;
    const moneyContext = MONEY_WORDS.test(all) || propertyNames(m.inputSchema).some((p) => /\b(?:amount|value|price|quantity)\b/.test(p));
    const moves =
      MONEY_VERBS.test(head) ||
      SIGNING.test(all) ||
      (CONTEXT_VERBS.test(head) && moneyContext) ||
      (/\bsign\b(?!\s+(?:up|in|out|on)\b)/.test(nameWords) && moneyContext);
    if (moves) {
      if (m.annotations.readOnlyHint) add('ask', 'readonly-but-moves-money', 'It says it only reads, but its name and inputs move money or sign. Airlock asks you before an agent runs it.');
      else if (m.annotations.consequentialHint) add('ask', 'moves-money', 'It moves money or signs, and says so. Airlock asks you before an agent runs it.');
      else add('ask', 'moves-money-undeclared', 'It moves money or signs, but doesn\'t mark itself as consequential, so an agent may not stop to ask. Airlock asks you.');
    }

    if (m.description.length > DESCRIPTION_BUDGET) add('note', 'long-description', `Its description is ${m.description.length} characters, past Chrome's ${DESCRIPTION_BUDGET}-character guidance. Long descriptions are where instructions hide.`);

    return { level: worst(reasons.map((r) => r.level)), reasons };
  }

  /** A declarative WebMCP tool (<form toolname=...>) as tool data, so it gets the same checks. */
  function describeForm(form) {
    const properties = {};
    for (const el of Array.from(form.elements || []).slice(0, 100)) {
      const name = el.getAttribute && (el.getAttribute('name') || el.id);
      if (!name || el.type === 'submit' || el.type === 'button') continue;
      const label = el.labels && el.labels[0] ? el.labels[0].textContent : '';
      properties[name] = {
        title: el.getAttribute('toolparamtitle') || '',
        description: el.getAttribute('toolparamdescription') || label || el.getAttribute('placeholder') || '',
      };
    }
    return describeTool({
      name: form.getAttribute('toolname'),
      description: form.getAttribute('tooldescription') || '',
      inputSchema: { type: 'object', properties },
    });
  }

  root.AirlockAgentTools = { checkTool, describeTool, describeForm, worst, DESCRIPTION_BUDGET, LEVELS };
})(globalThis);
