#!/usr/bin/env node
/**
 * Generates the parts of docs/architecture/ that must match the code: the module map and the
 * C4 level 3 component diagrams from the import graph, and the event catalogue from the
 * `GameEvent` union and the switch statements that consume it. Optionally renders every Mermaid
 * source under docs/architecture/diagrams/ to a PNG under docs/architecture/render/.
 *
 *   node scripts/architecture.mjs              # write modules.md, events.md and the .mmd sources
 *   node scripts/architecture.mjs --render     # also render diagrams/*.mmd to render/*.png
 *   node scripts/architecture.mjs --check      # exit 1 when a generated file differs from disk
 *
 * tests/unit/architecture.test.ts calls `generate()` and compares it with the checked-in files,
 * so a module, an import, an event or a consumer added to the code without re-running
 * `pnpm docs:architecture` fails the unit suite. Rendering needs a Chromium: mermaid-cli uses
 * Puppeteer's own cache, or the binary named by PUPPETEER_EXECUTABLE_PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { parseArgs } from './lib/args.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'docs', 'architecture');
const DIAGRAMS = join(OUT, 'diagrams');
const RENDER = join(OUT, 'render');

/**
 * One line per module. The generator refuses to run when a module under src/ has no entry or an
 * entry names a module that no longer exists, so the map can never silently go stale.
 */
const RESPONSIBILITIES = {
  'src/main.ts':
    'Fixed 60 Hz accumulator loop, hit-stop, overlay and pointer-lock lifecycle, settings panel, the `?record` capture hook',
  'src/core/game.ts':
    '`GameState`, `InputFrame`, the `GameEvent` union and `stepGame`: one simulation tick as a draft, eight systems in order, then a frozen state',
  'src/core/enemy.ts':
    'Enemy state machine (`spawning`, `chase`, `attack`, `flee`, `dead`), skimmer temperaments, the rout and its bark lines',
  'src/core/weapon.ts':
    'Six weapon kinds as data in `WEAPON_SPECS`; magazine, reload, trigger, charge, spin-up and falloff rules',
  'src/core/grenade.ts': 'Thrown grenades and launcher rounds: bounce, fuse, blast falloff',
  'src/core/projectile.ts': 'Strider bolts: flight, cover and floor stops, the hit sphere',
  'src/core/pickups.ts':
    'Weapon pickups: drops, wave rewards, expiry, reach and the two-slot inventory',
  'src/core/waves.ts':
    'Wave state machine, composition formula, `FINAL_WAVE`, the atmosphere table',
  'src/core/vitality.ts': 'Regenerating shield over fixed health; damage order and recharge',
  'src/core/world.ts':
    'Seeded arena generation, cover boxes, the hidden switch, axis-separated collision',
  'src/core/raycast.ts':
    'Ray against sphere and axis-aligned box; hitscan against targets and cover',
  'src/core/vec3.ts':
    'Immutable vector helpers and `directionFromAngles`, the single source of the yaw and pitch convention',
  'src/core/rng.ts': 'Seeded mulberry32 generator so every run is reproducible',
  'src/core/watcher.ts':
    'The watcher archetype: holds a perimeter band, strafes, telegraphs and fires a hitscan beam that cover stops',
  'src/core/bot.ts':
    'Scripted player: reads the state a human could see and returns an `InputFrame`',
  'src/core/playtest.ts': 'Headless games at 60 Hz, balance summaries and the gate evaluation',
  'src/core/records.ts':
    'Personal bests over a tiny storage interface; the browser passes `localStorage`',
  'src/core/settings.ts':
    'Sensitivity, field of view and motion toggles over the same storage interface',
  'src/render/scene.ts':
    '`SceneRenderer`: owns the three.js scene, camera and post stack; mirrors `GameState` every frame and plays effects for events',
  'src/render/environment.ts':
    'Sky, sun and moon, the ring, terrain, stars, the atmosphere rigs and weather overlays',
  'src/render/enemies.ts': 'Composite enemy rigs built from primitives, with their animation',
  'src/render/weapons.ts':
    'One viewmodel rig per weapon kind: draw, recoil, muzzle flash, tracers, beam and launcher effects',
  'src/render/pickups.ts': 'Pickup emblems, halos and the spawn and take flourishes',
  'src/render/particles.ts':
    'GPU particle pool: one `Points` draw call, birth state written once, integrated in the vertex shader',
  'src/render/watcher-rig.ts':
    'The watcher rig: a tall tripod with a lens that brightens over the charge, and the beam layer',
  'src/render/dropship.ts':
    'The dropship: a Hull craft that crosses the arena on the first dropPod of a wave, and the pods that fall from it',
  'src/render/dispose.ts':
    '`disposeTree`: frees geometry, materials and textures under an object before it is dropped',
  'src/render/post.ts': 'HDR composer: render pass, capped bloom prefilter, feel pass, ACES output',
  'src/render/lights.ts':
    "`LightPool`: a fixed set of point lights borrowed and returned, so the scene's light count never changes",
  'src/render/random.ts':
    "`renderRandom`: the renderer's one seeded source of randomness, so captures repeat frame for frame",
  'src/hud/hud.ts':
    'DOM heads-up display, announcements, hit marker, damage direction and the 2D-canvas motion tracker',
  'src/input/input.ts':
    'Keyboard, mouse, wheel and pointer lock into an `InputFrame`; one-shot actions latched between steps',
  'src/input/wheel.ts':
    'Wheel travel folded into swap notches: one swap per mouse click or per hundred trackpad pixels',
  'src/audio/audio.ts':
    '`AudioBank`: the WebAudio context, buses, the charge hum and the event-to-sound dispatch',
  'src/audio/sounds.ts':
    'The procedural sound table keyed by event, the `SILENT` list and the voice scheduler',
  'src/audio/music.ts':
    'Live score: choir drone, pulse and percussion placed on the audio clock from a wall-clock timer',
  'src/audio/offline.ts':
    'Offline score: re-runs a seeded playtest and renders its events into an `OfflineAudioContext`',
};

/** Which layers each layer may import. Checked on every run; a violation is a generator error. */
const ALLOWED = {
  core: ['core'],
  render: ['render', 'core', 'three'],
  hud: ['core'],
  input: ['input', 'core'],
  audio: ['audio', 'core'],
  main: ['core', 'render', 'hud', 'input', 'audio'],
};

/** Files whose switch statements and `.type ===` tests make them event consumers. */
const CONSUMERS = [
  { file: 'src/render/scene.ts', column: 'Renderer' },
  { file: 'src/render/weapons.ts', column: 'Renderer' },
  { file: 'src/render/pickups.ts', column: 'Renderer' },
  { file: 'src/render/watcher-rig.ts', column: 'Renderer' },
  { file: 'src/render/dropship.ts', column: 'Renderer' },
  { file: 'src/hud/hud.ts', column: 'HUD' },
  { file: 'src/core/playtest.ts', column: 'Playtest' },
  { file: 'src/core/bot.ts', column: 'Bot' },
  { file: 'src/main.ts', column: 'Loop' },
];

const FRONTMATTER = (title) =>
  [
    '---',
    'type: architecture',
    `title: "${title}"`,
    'status: draft',
    'authors:',
    '  - name: "Ringfall hackathon team"',
    'created: 2026-10-21',
    '---',
    '',
  ].join('\n');

const GENERATED_NOTICE =
  '<!-- Generated by scripts/architecture.mjs; edit the script, not this file. `pnpm docs:architecture` rewrites it and tests/unit/architecture.test.ts fails when it drifts from the code. -->';

const listSources = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listSources(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
    })
    .sort();

const parse = (path) =>
  ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);

const layerOf = (module) => (module === 'src/main.ts' ? 'main' : module.split('/')[1]);
const shortName = (module) => basename(module, '.ts');
const nodeId = (module) => `${layerOf(module)}_${shortName(module)}`;

// ---------------------------------------------------------------- module graph

/** True when an import declaration brings in only types, which the bundle erases. */
const isTypeOnlyImport = (clause) =>
  clause?.isTypeOnly === true ||
  (clause?.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.every((e) => e.isTypeOnly));

/** The imports of one source file, resolved to repository-relative paths or package names. */
const readImports = (file) =>
  parse(file)
    .statements.filter(ts.isImportDeclaration)
    .map((statement) => {
      const spec = statement.moduleSpecifier.text;
      const typeOnly = isTypeOnlyImport(statement.importClause);
      if (!spec.startsWith('.')) return { target: spec, layer: spec.split('/')[0], typeOnly };
      const target = `${relative(ROOT, resolve(dirname(file), spec))}.ts`;
      return { target, layer: layerOf(target), typeOnly };
    });

/** Every reason the module list cannot be documented as it stands. */
const moduleErrors = (modules) => {
  const known = new Set(modules.map((m) => m.module));
  const errors = [];
  for (const m of modules) {
    if (!m.responsibility)
      errors.push(`${m.module}: add a RESPONSIBILITIES entry in scripts/architecture.mjs`);
    for (const dep of m.imports) {
      if (dep.target.startsWith('src/') && !known.has(dep.target)) {
        errors.push(`${m.module} imports ${dep.target}, which does not exist`);
      }
      if (!ALLOWED[m.layer]?.includes(dep.layer)) {
        errors.push(
          `${m.module} (${m.layer}) imports ${dep.target} (${dep.layer}), which ALLOWED forbids`,
        );
      }
    }
  }
  for (const listed of Object.keys(RESPONSIBILITIES)) {
    if (!known.has(listed)) errors.push(`RESPONSIBILITIES names ${listed}, which does not exist`);
  }
  return errors;
};

/** Every module under src/ with its layer, responsibility and imports; throws on a rule break. */
const readModules = () => {
  const modules = listSources(SRC).map((file) => {
    const module = relative(ROOT, file);
    return {
      module,
      layer: layerOf(module),
      responsibility: RESPONSIBILITIES[module],
      imports: readImports(file),
    };
  });
  const errors = moduleErrors(modules);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return modules;
};

const flowchartHeader = (direction) => [
  `%%{init: {"flowchart": {"curve": "basis"}} }%%`,
  `flowchart ${direction}`,
];

const arrowFor = (typeOnly) => (typeOnly ? '-.->' : '-->');

/** A three.js addon import shown by its file name; a core module by its basename. */
const externalName = (dep) =>
  dep.layer === 'three'
    ? dep.target.replace(/^three\/addons\/.*\//, '').replace(/\.js$/, '')
    : shortName(dep.target);

/**
 * Edges for one layer: `internal` maps "from to" to whether every import between the pair is
 * type-only; `externals` collapses each module's imports of another layer into one labelled edge.
 */
const collectEdges = (own, layer) => {
  const internal = new Map();
  const externals = new Map();
  for (const m of own) {
    for (const dep of m.imports) {
      if (dep.layer === layer) {
        const key = `${nodeId(m.module)} ${nodeId(dep.target)}`;
        internal.set(key, (internal.get(key) ?? true) && dep.typeOnly);
        continue;
      }
      const key = `${m.module}>${dep.layer}`;
      const entry = externals.get(key) ?? {
        from: m.module,
        layer: dep.layer,
        names: new Set(),
        typeOnly: true,
      };
      entry.names.add(externalName(dep));
      entry.typeOnly = entry.typeOnly && dep.typeOnly;
      externals.set(key, entry);
    }
  }
  return {
    internal,
    externals: [...externals.values()].sort((a, b) => a.from.localeCompare(b.from)),
  };
};

/** C4 level 3 for one layer: its modules, their imports of each other, and collapsed externals. */
const componentDiagram = (modules, layer, title) => {
  const own = modules.filter((m) => m.layer === layer);
  const lines = flowchartHeader('LR');
  lines.push(`  subgraph ${layer}["${title}"]`);
  for (const m of own) lines.push(`    ${nodeId(m.module)}["${shortName(m.module)}.ts"]`);
  lines.push('  end');
  const { internal, externals } = collectEdges(own, layer);
  for (const [key, typeOnly] of internal) {
    const [from, to] = key.split(' ');
    lines.push(`  ${from} ${arrowFor(typeOnly)} ${to}`);
  }
  for (const ext of [...new Set(externals.map((e) => e.layer))].sort()) {
    lines.push(`  ${ext}(["${ext === 'three' ? 'three.js' : `src/${ext}/`}"])`);
  }
  for (const entry of externals) {
    const label = [...entry.names].sort().join(', ');
    lines.push(`  ${nodeId(entry.from)} ${arrowFor(entry.typeOnly)}|"${label}"| ${entry.layer}`);
  }
  return `${lines.join('\n')}\n`;
};

const tick = (text) => `\`${text}\``;

const modulesMarkdown = (modules) => {
  const edges = modules.flatMap((m) => m.imports.filter((d) => d.target.startsWith('src/')));
  const layers = [...new Set(modules.map((m) => m.layer))];
  const lines = [
    FRONTMATTER('Ringfall module map'),
    GENERATED_NOTICE,
    '',
    '# Ringfall module map',
    '',
    '> [Ringfall](../../README.md) > [Architecture](README.md) > Module map',
    '',
    `Every TypeScript module under ${tick('src/')} with its responsibility and what it imports, read from the import declarations by ${tick('scripts/architecture.mjs')}. The tree holds ${modules.length} modules in ${layers.length} layers (${layers.map((l) => tick(l)).join(', ')}) joined by ${edges.length} internal imports. A dotted arrow in the diagrams is a type-only import, which Vite erases from the bundle; a solid arrow carries runtime code.`,
    '',
    '## Allowed dependencies',
    '',
    `The generator refuses to run when an import crosses a line this table does not allow, so the table is a rule the code is held to, not a description of it. Biome and ${tick('tests/unit/purity.test.ts')} enforce the core row a second way.`,
    '',
    '| Layer | May import | Why |',
    '| ----- | ---------- | --- |',
    `| ${tick('core')} | ${tick('core')} | The simulation runs in Node with no renderer, DOM, clock or unseeded randomness ([ADR-0002](../adr/0002-pure-simulation-core.md)) |`,
    `| ${tick('render')} | ${tick('render')}, ${tick('core')}, ${tick('three')} | The only layer that owns WebGL objects ([ADR-0001](../adr/0001-typescript-three-vite.md)) |`,
    `| ${tick('hud')} | ${tick('core')} | DOM and 2D canvas only; it reads state and events |`,
    `| ${tick('input')} | ${tick('core')} | Produces the ${tick('InputFrame')} the core consumes |`,
    `| ${tick('audio')} | ${tick('audio')}, ${tick('core')} | WebAudio only; the offline score re-runs a core playtest |`,
    `| ${tick('main')} | every layer | The composition root wires the others together |`,
    '',
    '## Core components',
    '',
    `C4 level 3 for ${tick('src/core/')}. Every arrow is an import; the core imports nothing outside itself.`,
    '',
    '![Core components: the modules under src/core and their imports](render/core-components.png)',
    '',
    `Source: [diagrams/core-components.mmd](diagrams/core-components.mmd).`,
    '',
    '## Renderer components',
    '',
    `C4 level 3 for ${tick('src/render/')}. Imports from the core are collapsed into one node and labeled with the modules they come from; three.js is the only external dependency.`,
    '',
    '![Renderer components: the modules under src/render, their imports of each other, of the core and of three.js](render/render-components.png)',
    '',
    `Source: [diagrams/render-components.mmd](diagrams/render-components.mmd).`,
    '',
    '## Module table',
    '',
    '| Module | Layer | Responsibility | Imports |',
    '| ------ | ----- | -------------- | ------- |',
  ];
  for (const m of modules) {
    const imports = m.imports
      .map((d) => {
        const name = d.target.startsWith('src/')
          ? d.target.replace(/^src\//, '').replace(/\.ts$/, '')
          : d.target;
        return d.typeOnly ? `${tick(name)} (types)` : tick(name);
      })
      .join(', ');
    lines.push(
      `| ${tick(m.module)} | ${tick(m.layer)} | ${m.responsibility} | ${imports || 'none'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
};

// ---------------------------------------------------------------- event catalogue

const escapeCell = (text) => text.replace(/\|/g, '\\|');

/** The enclosing named function of a node: `const name = (...) => {}` or `function name() {}`. */
const enclosingFunction = (node) => {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && current.initializer) {
      if (ts.isArrowFunction(current.initializer) || ts.isFunctionExpression(current.initializer)) {
        return current.name.text;
      }
    }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return '(module scope)';
};

const walk = (node, visit) => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};

/**
 * Doc comment between the previous union member and this one, without the comment markers. The
 * comment sits before the `|` token, so it is not in the member's own leading trivia.
 */
const docComment = (sf, member, previousEnd) => {
  const between = sf.text.slice(previousEnd, member.getStart(sf));
  const doc = [...between.matchAll(/\/\*\*[\s\S]*?\*\//g)].map((m) => m[0]).pop();
  if (!doc) return '';
  return doc
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ');
};

/** The `GameEvent` union: one entry per member with its payload fields and doc comment. */
const readEvents = (sf) => {
  const alias = sf.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'GameEvent',
  );
  if (!alias || !ts.isUnionTypeNode(alias.type))
    throw new Error('src/core/game.ts: GameEvent is not a union type');
  let previousEnd = alias.name.end;
  return alias.type.types.map((member) => {
    if (!ts.isTypeLiteralNode(member))
      throw new Error('GameEvent: every member must be an object type');
    const doc = docComment(sf, member, previousEnd);
    previousEnd = member.end;
    let type = null;
    const fields = [];
    for (const prop of member.members) {
      if (!ts.isPropertySignature(prop) || !prop.name || !prop.type) continue;
      const name = prop.name.getText(sf);
      if (
        name === 'type' &&
        ts.isLiteralTypeNode(prop.type) &&
        ts.isStringLiteral(prop.type.literal)
      ) {
        type = prop.type.literal.text;
      } else {
        fields.push(`${name}: ${prop.type.getText(sf)}`);
      }
    }
    if (type === null) throw new Error('GameEvent: a member has no literal `type`');
    return { type, fields, doc };
  });
};

/** `d.events.push({ type: 'x', ... })` sites in game.ts, keyed by event type. */
const readProducers = (sf) => {
  const producers = new Map();
  walk(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (
      node.expression.name.text !== 'push' ||
      !/events$/.test(node.expression.expression.getText(sf))
    )
      return;
    for (const arg of node.arguments) {
      if (!ts.isObjectLiteralExpression(arg)) continue;
      const typeProp = arg.properties.find(
        (p) =>
          ts.isPropertyAssignment(p) &&
          p.name.getText(sf) === 'type' &&
          ts.isStringLiteral(p.initializer),
      );
      if (!typeProp) continue;
      const type = typeProp.initializer.text;
      const set = producers.get(type) ?? new Set();
      set.add(enclosingFunction(node));
      producers.set(type, set);
    }
  });
  return producers;
};

/** The clause whose statements a case runs: itself, or the next non-empty one it falls through to. */
const effectiveClause = (clauses, index) => {
  let j = index;
  while (clauses[j].statements.length === 0 && j + 1 < clauses.length) j += 1;
  return clauses[j];
};

/** What a case clause does with its event: nothing, a HUD announcement, or other code. */
const classifyClause = (sf, body) => {
  const onlyBreak = body.statements.length === 1 && ts.isBreakStatement(body.statements[0]);
  if (onlyBreak) return 'named, no action';
  return /this\.announce\(/.test(body.getText(sf)) ? 'announces' : 'reacts';
};

/** `x.type === 'literal'` or `x.type !== 'literal'` (a guard that continues past other events). */
const isTypeTest = (node) =>
  ts.isBinaryExpression(node) &&
  (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
  ts.isPropertyAccessExpression(node.left) &&
  node.left.name.text === 'type' &&
  ts.isStringLiteral(node.right);

/** A switch on `x.type` or a `x.type === 'literal'` test (or its `!==` guard): what a file reacts to. */
const readConsumer = (file) => {
  const sf = parse(join(ROOT, file));
  const handled = new Map();
  const note = (type, detail) => {
    const set = handled.get(type) ?? new Set();
    set.add(detail);
    handled.set(type, set);
  };
  walk(sf, (node) => {
    if (ts.isSwitchStatement(node) && /\.type$/.test(node.expression.getText(sf))) {
      const clauses = node.caseBlock.clauses;
      clauses.forEach((clause, i) => {
        if (!ts.isCaseClause(clause) || !ts.isStringLiteral(clause.expression)) return;
        note(clause.expression.text, classifyClause(sf, effectiveClause(clauses, i)));
      });
    }
    if (isTypeTest(node)) note(node.right.text, 'reacts');
  });
  return handled;
};

/** The length of a sound entry's `voices` array literal, or null when a helper builds it. */
const voiceCount = (sf, initializer) => {
  if (!ts.isObjectLiteralExpression(initializer)) return null;
  const voices = initializer.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'voices',
  );
  return voices && ts.isArrayLiteralExpression(voices.initializer)
    ? voices.initializer.elements.length
    : null;
};

/** `SOUNDS` as a map from key to voice count. */
const readSoundTable = (sf, initializer) => {
  const sounds = new Map();
  for (const prop of initializer.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(sf);
    sounds.set(key, voiceCount(sf, prop.initializer));
  }
  return sounds;
};

/** The string literals of `SILENT`, under its `as const satisfies` wrapper. */
const readSilentList = (initializer) => {
  let inner = initializer;
  while (ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) inner = inner.expression;
  if (!ts.isArrayLiteralExpression(inner)) return [];
  return inner.elements.filter(ts.isStringLiteral).map((el) => el.text);
};

/** `SOUNDS` keys with their voice counts and the `SILENT` list from src/audio/sounds.ts. */
const readSounds = () => {
  const sf = parse(join(ROOT, 'src/audio/sounds.ts'));
  let sounds = new Map();
  let silent = [];
  walk(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    if (node.name.text === 'SOUNDS' && ts.isObjectLiteralExpression(node.initializer)) {
      sounds = readSoundTable(sf, node.initializer);
    }
    if (node.name.text === 'SILENT') silent = readSilentList(node.initializer);
  });
  if (sounds.size === 0) throw new Error('src/audio/sounds.ts: SOUNDS not found');
  return { sounds, silent };
};

const soundCell = (type, { sounds, silent }) => {
  if (silent.includes(type)) return `${tick('SILENT')}`;
  const keys = [...sounds.keys()].filter((k) => k === type || k.startsWith(`${type}:`));
  if (keys.length === 0) return 'missing';
  return keys
    .map((k) => {
      const voices = sounds.get(k);
      const count =
        voices === null
          ? 'voices from a helper'
          : voices === 0
            ? 'no voices'
            : `${voices} voice${voices === 1 ? '' : 's'}`;
      return `${tick(k)} (${count})`;
    })
    .join(', ');
};

const eventsMarkdown = () => {
  const gameFile = join(ROOT, 'src/core/game.ts');
  const sf = parse(gameFile);
  const events = readEvents(sf);
  const producers = readProducers(sf);
  const consumers = CONSUMERS.map((c) => ({ ...c, handled: readConsumer(c.file) }));
  const audio = readSounds();
  const columns = [...new Set(CONSUMERS.map((c) => c.column))];
  const unproduced = events.filter((e) => !producers.has(e.type)).map((e) => e.type);
  const unknownProducers = [...producers.keys()].filter((t) => !events.some((e) => e.type === t));
  if (unknownProducers.length > 0)
    throw new Error(`game.ts pushes events not in GameEvent: ${unknownProducers.join(', ')}`);
  const silentCount = events.filter((e) => audio.silent.includes(e.type)).length;
  const idle = consumers.filter((c) => c.handled.size === 0);

  const cellFor = (column, type) => {
    const details = new Set();
    for (const c of consumers) {
      if (c.column !== column) continue;
      for (const d of c.handled.get(type) ?? []) details.add(`${basename(c.file, '.ts')}: ${d}`);
    }
    return [...details].sort().join('; ');
  };

  const lines = [
    FRONTMATTER('Ringfall event catalogue'),
    GENERATED_NOTICE,
    '',
    '# Ringfall event catalogue',
    '',
    '> [Ringfall](../../README.md) > [Architecture](README.md) > Event catalogue',
    '',
    `Every member of the ${tick('GameEvent')} union in ${tick('src/core/game.ts')}, with the function in ${tick('stepGame')} that pushes it, the presentation code that switches on it, and its entry in the sound table. ${tick('scripts/architecture.mjs')} reads the union, the ${tick('events.push')} sites, the ${tick('switch (e.type)')}, ${tick('e.type ===')} and ${tick('e.type !==')} tests in the consumer files, and ${tick('SOUNDS')} and ${tick('SILENT')} in ${tick('src/audio/sounds.ts')}. The union has ${events.length} events; ${silentCount} are silent on purpose and the rest have a sound. A consumer cell names the file and what it does: ${tick('reacts')} runs code, ${tick('announces')} prints a HUD message, ${tick('named, no action')} lists the case and breaks.`,
    '',
  ];
  if (idle.length > 0) {
    lines.push(
      `${idle.map((c) => tick(c.file)).join(' and ')} ${idle.length === 1 ? 'is' : 'are'} scanned and consume${idle.length === 1 ? 's' : ''} no event: the bot reads ${tick('GameState')} directly, as a player reads the screen.`,
      '',
    );
  }
  if (unproduced.length > 0) {
    lines.push(
      `Events declared but never pushed by ${tick('stepGame')}: ${unproduced.map(tick).join(', ')}.`,
      '',
    );
  }
  lines.push(
    '## Catalogue',
    '',
    `| Event | Payload | Producer | ${columns.join(' | ')} | Sound |`,
    `| ----- | ------- | -------- | ${columns.map(() => '---').join(' | ')} | ----- |`,
  );
  for (const e of events) {
    const payload = e.fields.length > 0 ? escapeCell(e.fields.map(tick).join(', ')) : 'none';
    const producer = [...(producers.get(e.type) ?? [])].sort().map(tick).join(', ') || 'none';
    const cells = columns.map((c) => cellFor(c, e.type) || '');
    lines.push(
      `| ${tick(e.type)} | ${payload} | ${producer} | ${cells.join(' | ')} | ${soundCell(e.type, audio)} |`,
    );
  }
  lines.push('', '## Notes from the source', '');
  const documented = events.filter((e) => e.doc);
  if (documented.length === 0) lines.push('No event carries a doc comment.');
  for (const e of documented) lines.push(`- ${tick(e.type)}: ${e.doc}`);
  lines.push('');
  return { markdown: lines.join('\n'), count: events.length };
};

// ---------------------------------------------------------------- driver

/** Every generated file as `{ path: content }`, relative to the repository root. */
export const generate = () => {
  const modules = readModules();
  const events = eventsMarkdown();
  return {
    files: {
      'docs/architecture/diagrams/core-components.mmd': componentDiagram(
        modules,
        'core',
        'src/core/ (pure simulation)',
      ),
      'docs/architecture/diagrams/render-components.mmd': componentDiagram(
        modules,
        'render',
        'src/render/ (three.js)',
      ),
      'docs/architecture/modules.md': modulesMarkdown(modules),
      'docs/architecture/events.md': events.markdown,
    },
    moduleCount: modules.length,
    eventCount: events.count,
  };
};

const renderDiagrams = () => {
  const sources = readdirSync(DIAGRAMS)
    .filter((f) => f.endsWith('.mmd'))
    .sort();
  mkdirSync(RENDER, { recursive: true });
  const config = { args: ['--no-sandbox', '--disable-gpu'] };
  if (process.env.PUPPETEER_EXECUTABLE_PATH)
    config.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const tmp = mkdtempSync(join(tmpdir(), 'ringfall-mmd-'));
  const puppeteer = join(tmp, 'puppeteer.json');
  writeFileSync(puppeteer, JSON.stringify(config));
  try {
    for (const source of sources) {
      const out = join(RENDER, source.replace(/\.mmd$/, '.png'));
      execFileSync(
        join(ROOT, 'node_modules', '.bin', 'mmdc'),
        ['-p', puppeteer, '-i', join(DIAGRAMS, source), '-o', out, '-b', 'white', '-s', '2', '-q'],
        { stdio: 'inherit' },
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return sources.length;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2), new Set(['check', 'render']));
  const { files, moduleCount, eventCount } = generate();
  let drift = 0;
  for (const [path, content] of Object.entries(files)) {
    const full = join(ROOT, path);
    let current = null;
    try {
      current = readFileSync(full, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) continue;
    drift += 1;
    if (args.check) {
      console.error(`${path}: differs from the generator's output; run pnpm docs:architecture`);
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      console.log(`wrote ${path}`);
    }
  }
  console.log(
    `${moduleCount} modules, ${eventCount} events, ${drift} file(s) ${args.check ? 'out of date' : 'written'}`,
  );
  if (args.check && drift > 0) process.exit(1);
  if (args.render)
    console.log(`rendered ${renderDiagrams()} diagram(s) to docs/architecture/render/`);
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  main();
