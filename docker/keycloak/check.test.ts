/*
 * Checks on the `occ` Keycloak sign-in theme (V2-20.7, ADR-0010 "Settled in V2-20.1"): the things the page
 * promises that no browser test covers (there is none for a theme, Playwright being OCC-25).
 *
 *   pnpm keycloak:test        node --test "docker/keycloak/*.test.ts"
 *
 * Not part of `pnpm test`, like `models:test`. The colours are checked elsewhere, by `pnpm lint`
 * (apps/console/scripts/contrast.ts): every copy of a token, the two posters and the contrast over the picture.
 * No JSON lives next to this file on purpose: Compose mounts this folder as Keycloak's realm import directory.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const THEME = join(ROOT, 'docker/keycloak/themes/occ/login');
const IMG = join(THEME, 'resources/img');

/** The size budgets of V2-20.1: a page this public is loaded cold, over any link. */
const LOOP_MAX_BYTES = 1_500_000;
const POSTER_MAX_BYTES = 150_000;

const read = (file: string) => readFileSync(file, 'utf8');

/** Every file under `dir`, relative paths from `base`. */
function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full, base) : [full.slice(base.length + 1)];
  });
}

/** The text of a theme file without its comments, which may name a URL (the copied template cites a bug). */
function withoutComments(file: string, text: string): string {
  if (file.endsWith('.css')) return text.replace(/\/\*[\s\S]*?\*\//g, '');
  if (file.endsWith('.properties')) return text.replace(/^\s*#.*$/gm, '');
  if (file.endsWith('.ftl')) {
    return text.replace(/<#--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  return text;
}

const textFiles = files(THEME).filter((f) => /\.(css|ftl|properties)$/.test(f));

test('the backdrop is under its size budget', () => {
  const loop = statSync(join(IMG, 'campus-loop.webm')).size;
  const poster = statSync(join(IMG, 'campus-poster.webp')).size;

  assert.ok(
    loop <= LOOP_MAX_BYTES,
    `campus-loop.webm is ${loop} B, the budget is ${LOOP_MAX_BYTES} B`,
  );
  assert.ok(
    poster <= POSTER_MAX_BYTES,
    `campus-poster.webp is ${poster} B, the budget is ${POSTER_MAX_BYTES} B`,
  );
});

test('the theme asks for nothing outside this host', () => {
  const urls = textFiles.flatMap((file) => {
    const text = withoutComments(file, read(join(THEME, file)));
    return [...text.matchAll(/https?:\/\/[^\s"')]+/g)].map(([url]) => `${file}: ${url}`);
  });

  assert.deepEqual(urls, [], 'a font, script, image or video from another host');
});

test('the realm sets the theme, and turns on what the page says', () => {
  const realm = JSON.parse(read(join(ROOT, 'docker/keycloak/occ-realm.json'))) as Record<
    string,
    unknown
  >;

  assert.equal(realm['loginTheme'], 'occ');
  // "Keep me signed in on this device" and "Sign-ins are recorded." are sentences of the page.
  assert.equal(realm['rememberMe'], true);
  assert.equal(realm['eventsEnabled'], true);
  // A video wall signs in once with "Keep me signed in" and must outlive Keycloak's defaults (30 min idle, 10 h at most;
  // V2-21.10). The numbers are the demo's proposal; a real site sets its own.
  const idle = realm['ssoSessionIdleTimeoutRememberMe'];
  const max = realm['ssoSessionMaxLifespanRememberMe'];
  assert.ok(
    typeof idle === 'number' && idle > 10 * 3600,
    'the remember-me idle limit is not above 10 h',
  );
  assert.ok(
    typeof max === 'number' && max > 10 * 3600,
    'the remember-me session limit is not above 10 h',
  );
  assert.ok(
    typeof idle === 'number' && typeof max === 'number' && idle <= max,
    'idle is longer than the whole session',
  );
  assert.ok(
    Array.isArray(realm['enabledEventTypes']) && realm['enabledEventTypes'].includes('LOGIN'),
    'sign-ins are not recorded: LOGIN is not in enabledEventTypes',
  );
});

test('the theme is a child of keycloak.v2 and loads its own stylesheet after the parent', () => {
  const properties = read(join(THEME, 'theme.properties'));

  assert.match(properties, /^parent=keycloak\.v2$/m);
  assert.match(properties, /^styles=css\/styles\.css css\/occ\.css$/m);
});

test('every message the template asks for exists', () => {
  const template = read(join(THEME, 'template.ftl'));
  const messages = withoutComments(
    'messages_en.properties',
    read(join(THEME, 'messages/messages_en.properties')),
  );
  const defined = new Set([...messages.matchAll(/^(\w+)=/gm)].map(([, key]) => key));
  const asked = [...template.matchAll(/msg\("(occ\w+)"\)/g)].map(([, key]) => key);

  assert.ok(asked.length > 0, 'the template asks for no occ message at all');
  assert.deepEqual(
    asked.filter((key) => !defined.has(key)),
    [],
    'messages_en.properties lacks keys the template asks for',
  );
});

test('every file the template and the stylesheet name is in the theme', () => {
  const template = read(join(THEME, 'template.ftl'));
  const css = read(join(THEME, 'resources/css/occ.css'));
  const named = [
    ...[...template.matchAll(/resourcesPath\}\/([\w./-]+)/g)].map(([, file]) => file),
    ...[...css.matchAll(/url\('\.\.\/([\w./-]+)'\)/g)].map(([, file]) => file),
  ] as string[];
  const present = new Set(files(join(THEME, 'resources')));
  // `css/styles.css` and `js/…` come from the parent theme: only what this theme ships is held to this.
  const ours = named.filter((file) => file.startsWith('img/campus-') || file.startsWith('fonts/'));

  assert.ok(ours.length >= 6, 'expected the loop, the poster and four fonts to be named');
  assert.deepEqual(
    ours.filter((file) => !present.has(file)),
    [],
    'the theme names a file it does not hold',
  );
});

test('the copied template names the Keycloak that Compose runs', () => {
  const header = read(join(THEME, 'template.ftl')).slice(0, 600);
  const copiedFrom = /Keycloak (\d+\.\d+)/.exec(header)?.[1];
  const running = /image:\s*quay\.io\/keycloak\/keycloak:(\d+\.\d+)/.exec(
    read(join(ROOT, 'docker/docker-compose.yml')),
  )?.[1];

  assert.ok(copiedFrom, 'template.ftl does not say which Keycloak it was copied from');
  assert.equal(
    copiedFrom,
    running,
    `template.ftl was copied from Keycloak ${copiedFrom} and Compose runs ${running}: diff it against that version's keycloak.v2 template.ftl`,
  );
});
