import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GITHUB_RESERVED,
  normalizeRepositoryLink,
  npmPackageFromPath,
  parseRepoInput,
  repoFromGitHubUrl,
  repoFromPage,
  repoLabel,
} from '../lib/repo.js';

const EXPRESS = 'https://github.com/expressjs/express';

describe('repoFromGitHubUrl', () => {
  it('reads the repo from any page inside it', () => {
    for (const href of [
      'https://github.com/expressjs/express',
      'https://github.com/expressjs/express/',
      'https://github.com/expressjs/express/tree/master/lib',
      'https://github.com/expressjs/express/blob/master/package.json#L12',
      'https://github.com/expressjs/express/issues/123',
      'https://github.com/expressjs/express/pulls?q=is%3Aopen',
      'https://github.com/expressjs/express.git',
      'https://www.github.com/expressjs/express',
      'http://github.com/expressjs/express',
    ]) {
      assert.equal(repoFromGitHubUrl(href), EXPRESS, href);
    }
  });

  it('keeps names with dots, dashes and underscores', () => {
    assert.equal(repoFromGitHubUrl('https://github.com/my-org/.github'), 'https://github.com/my-org/.github');
    assert.equal(repoFromGitHubUrl('https://github.com/a_b/c.d-e'), 'https://github.com/a_b/c.d-e');
  });

  it('ignores profiles, GitHub pages and gists', () => {
    for (const href of [
      'https://github.com/',
      'https://github.com/expressjs',
      'https://github.com/expressjs?tab=repositories',
      'https://github.com/settings/profile',
      'https://github.com/orgs/expressjs/people',
      'https://github.com/marketplace/actions/checkout',
      'https://github.com/explore',
      'https://github.com/topics/javascript',
      'https://github.com/notifications',
      'https://github.com/pulls/review-requested',
      'https://github.com/issues/assigned',
      'https://github.com/login/oauth/authorize',
      'https://github.com/sponsors/someone',
      'https://github.com/features/actions',
      'https://github.com/enterprise/startups',
      'https://github.com/pricing',
      'https://github.com/about/careers',
      'https://github.com/search?q=airlock',
      'https://github.com/new/import',
      'https://github.com/codespaces/new',
      'https://github.com/collections/machine-learning',
      'https://github.com/trending/python',
      'https://github.com/apps/dependabot',
      'https://github.com/users/someone/projects/1',
      'https://github.com/account/billing',
      'https://github.com/dashboard/feed',
      'https://github.com/site/terms',
      'https://github.com/security/advanced-security',
      'https://github.com/customer-stories/acme',
      'https://github.com/readme/featured',
      'https://github.com/events/universe',
      'https://github.com/team/plans',
      'https://github.com/Settings/profile',
      'https://gist.github.com/someone/abc123',
      'https://github.com/gist/abc123',
    ]) {
      assert.equal(repoFromGitHubUrl(href), null, href);
    }
  });

  it('keeps real orgs that share a word with GitHub pages', () => {
    assert.equal(repoFromGitHubUrl('https://github.com/github/docs'), 'https://github.com/github/docs');
    assert.equal(repoFromGitHubUrl('https://github.com/skills/introduction-to-github'), 'https://github.com/skills/introduction-to-github');
  });

  it('rejects other hosts, schemes and unsafe names', () => {
    for (const href of [
      'https://gitlab.com/expressjs/express',
      'https://github.com.evil.example/expressjs/express',
      'https://raw.githubusercontent.com/expressjs/express/master/x',
      'javascript:alert(1)',
      'ftp://github.com/expressjs/express',
      'https://github.com/expressjs/..',
      'https://github.com/expressjs/.git',
      'https://github.com/expr%20essjs/express',
      'not a url',
      '',
    ]) {
      assert.equal(repoFromGitHubUrl(href), null, href);
    }
  });

  it('lists every GitHub page the brief names', () => {
    for (const word of ['settings', 'orgs', 'marketplace', 'explore', 'topics', 'notifications', 'pulls',
      'issues', 'login', 'sponsors', 'features', 'enterprise', 'pricing', 'about', 'search', 'new',
      'codespaces', 'collections', 'trending', 'apps', 'users', 'account', 'dashboard', 'site',
      'security', 'customer-stories', 'readme', 'events', 'team']) {
      assert.ok(GITHUB_RESERVED.has(word), word);
    }
  });
});

describe('normalizeRepositoryLink', () => {
  it('accepts every shape package.json allows', () => {
    for (const link of [
      'https://github.com/expressjs/express',
      'https://github.com/expressjs/express#readme',
      'git+https://github.com/expressjs/express.git',
      'git://github.com/expressjs/express.git',
      'git+ssh://git@github.com/expressjs/express.git',
      'ssh://git@github.com/expressjs/express.git',
      'git@github.com:expressjs/express.git',
      'github:expressjs/express',
      'github.com/expressjs/express',
      'https://github.com/expressjs/express/tree/main/packages/router',
      'https://www.github.com/expressjs/express/',
      '  https://github.com/expressjs/express  ',
    ]) {
      assert.equal(normalizeRepositoryLink(link), EXPRESS, link);
    }
  });

  it('rejects links that are not GitHub repositories', () => {
    for (const link of [
      'https://gitlab.com/expressjs/express',
      'git+https://bitbucket.org/a/b.git',
      'https://github.com/expressjs',
      'https://github.com/sponsors/expressjs',
      'https://expressjs.com',
      '',
      null,
      undefined,
      42,
      `https://github.com/a/${'b'.repeat(3000)}`,
    ]) {
      assert.equal(normalizeRepositoryLink(link), null, String(link));
    }
  });
});

describe('npmPackageFromPath', () => {
  it('finds plain, scoped and versioned packages', () => {
    assert.equal(npmPackageFromPath('/package/express'), 'express');
    assert.equal(npmPackageFromPath('/package/express/v/4.21.0'), 'express');
    assert.equal(npmPackageFromPath('/package/@babel/core'), '@babel/core');
    assert.equal(npmPackageFromPath('/package/@babel/core/v/7.0.0'), '@babel/core');
    assert.equal(npmPackageFromPath('/package/%40babel%2Fcore'), '@babel/core');
    assert.equal(npmPackageFromPath('/package/JSONStream'), 'JSONStream');
  });

  it('ignores other npm pages', () => {
    for (const path of ['/', '/package', '/package/', '/package/@babel', '/search', '/~someone',
      '/org/babel', '/package/%E0%A4%A', '/package/<script>']) {
      assert.equal(npmPackageFromPath(path), null, path);
    }
  });
});

describe('repoFromPage', () => {
  it('uses the address on GitHub', () => {
    assert.equal(repoFromPage({ href: 'https://github.com/expressjs/express/issues' }), EXPRESS);
    assert.equal(repoFromPage({ href: 'https://github.com/settings' }), null);
  });

  it('uses the sidebar repository link on an npm package page', () => {
    assert.equal(
      repoFromPage({
        href: 'https://www.npmjs.com/package/@babel/core',
        repositoryLinks: ['https://github.com/babel/babel/tree/main/packages/babel-core'],
      }),
      'https://github.com/babel/babel',
    );
  });

  it('skips links it cannot use and takes the first GitHub one', () => {
    assert.equal(
      repoFromPage({
        href: 'https://www.npmjs.com/package/express',
        repositoryLinks: ['https://gitlab.com/x/y', 'git+https://github.com/expressjs/express.git'],
      }),
      EXPRESS,
    );
  });

  it('finds nothing when npm has no GitHub link, or the page is not a package', () => {
    assert.equal(repoFromPage({ href: 'https://www.npmjs.com/package/x', repositoryLinks: [] }), null);
    assert.equal(repoFromPage({ href: 'https://www.npmjs.com/package/x' }), null);
    assert.equal(repoFromPage({ href: 'https://www.npmjs.com/search?q=x', repositoryLinks: [EXPRESS] }), null);
    assert.equal(repoFromPage({ href: 'https://www.npmjs.com/package/x', repositoryLinks: 'oops' }), null);
  });

  it('finds nothing elsewhere', () => {
    assert.equal(repoFromPage({ href: 'https://example.com/expressjs/express' }), null);
    assert.equal(repoFromPage({ href: 'garbage' }), null);
    assert.equal(repoFromPage(), null);
  });
});

describe('parseRepoInput', () => {
  it('accepts what people paste', () => {
    for (const text of [
      'https://github.com/expressjs/express',
      'github.com/expressjs/express',
      'github.com/expressjs/express.git',
      'https://github.com/expressjs/express/blob/master/index.js',
      'git@github.com:expressjs/express.git',
      'expressjs/express',
      ' expressjs/express ',
    ]) {
      assert.deepEqual(parseRepoInput(text), { ok: true, url: EXPRESS }, text);
    }
  });

  it('explains what is wrong', () => {
    for (const text of ['', '   ', 'hello', 'github.com/expressjs', 'https://gitlab.com/a/b', 'settings/profile']) {
      const result = parseRepoInput(text);
      assert.equal(result.ok, false, text);
      assert.match(result.error, /\S/);
      assert.doesNotMatch(result.error, /!/);
    }
    assert.match(parseRepoInput('https://www.npmjs.com/package/express').error, /npm page/);
  });
});

describe('repoLabel', () => {
  it('shows owner/name', () => {
    assert.equal(repoLabel(EXPRESS), 'expressjs/express');
    assert.equal(repoLabel('something else'), 'something else');
    assert.equal(repoLabel(undefined), '');
  });
});
