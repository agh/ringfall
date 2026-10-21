import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENEMY_STATS,
  type EnemyKind,
  FLEE_DURATION,
  FLEE_RADIUS,
  FLEE_SPEED_FACTOR,
  SPAWN_DELAY,
} from '../../src/core/enemy';
import {
  GRAVITY,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_SPRINT_SPEED,
  SPAWN_RING_RADIUS,
  STARTING_GRENADES,
} from '../../src/core/game';
import {
  GRENADE_BLAST_RADIUS,
  GRENADE_FUSE,
  GRENADE_GRAVITY,
  GRENADE_MAX_DAMAGE,
  GRENADE_RESTITUTION,
  GRENADE_THROW_SPEED,
  ROUND_BLAST_RADIUS,
} from '../../src/core/grenade';
import { BOLT_LIFETIME, BOLT_SPEED } from '../../src/core/projectile';
import { createRng } from '../../src/core/rng';
import {
  createVitality,
  SHIELD_RECHARGE_DELAY,
  SHIELD_RECHARGE_RATE,
} from '../../src/core/vitality';
import {
  ATMOSPHERE_TABLE,
  FINAL_WAVE,
  WAVE_BONUS,
  WAVE_CLEAR_PAUSE,
  WAVE_COUNTDOWN,
  waveComposition,
} from '../../src/core/waves';
import {
  FALLOFF_FLOOR,
  MINIGUN_IDLE_RATE,
  WEAPON_KINDS,
  WEAPON_SPECS,
  type WeaponSpec,
} from '../../src/core/weapon';
import { ARENA_HALF_SIZE, generateArena } from '../../src/core/world';

/**
 * The design document quotes the gameplay numbers; the constants under
 * `src/core/` hold them. This test reads the document, parses the tables
 * and sentences between `<!-- design-check: NAME -->` markers with a few
 * lines of string handling (no Markdown library), and compares every
 * quoted number to the constant it names. A failure names the section,
 * the table row and column, or the sentence, so the document can be fixed
 * from the constant rather than the other way round.
 */
const DOC_PATH = join(__dirname, '..', '..', 'docs', 'design-doc.md');
const doc = readFileSync(DOC_PATH, 'utf8');

interface Table {
  readonly section: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** Text between `<!-- design-check: name -->` and `<!-- /design-check: name -->`. */
const section = (name: string): string => {
  const open = `<!-- design-check: ${name} -->`;
  const close = `<!-- /design-check: ${name} -->`;
  const start = doc.indexOf(open);
  const end = doc.indexOf(close, start);
  if (start < 0 || end < 0) {
    throw new Error(`docs/design-doc.md is missing the markers ${open} and ${close}`);
  }
  return doc.slice(start + open.length, end);
};

/** Collapses line wrapping so a sentence can be matched by one regular expression. */
const prose = (text: string): string => text.replace(/\s+/g, ' ');

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

/** The first pipe table inside a section. */
const parseTable = (name: string): Table => {
  const lines = section(name).split('\n');
  const start = lines.findIndex((line) => line.trim().startsWith('|'));
  if (start < 0) throw new Error(`docs/design-doc.md section "${name}" has no table`);
  let end = start;
  while (end < lines.length && lines[end]?.trim().startsWith('|')) end += 1;
  const [header, separator, ...body] = lines.slice(start, end);
  if (header === undefined || separator === undefined || !/^\|?\s*:?-{3,}/.test(separator)) {
    throw new Error(`docs/design-doc.md section "${name}": the table has no header row`);
  }
  return { section: name, columns: splitRow(header), rows: body.map(splitRow) };
};

const cell = (table: Table, row: string, column: string): string => {
  const index = table.columns.indexOf(column);
  if (index < 0) {
    throw new Error(`docs/design-doc.md table "${table.section}" has no column "${column}"`);
  }
  const found = table.rows.find((r) => r[0] === row);
  if (found === undefined) {
    throw new Error(`docs/design-doc.md table "${table.section}" has no row "${row}"`);
  }
  return found[index] ?? '';
};

const expectCell = (table: Table, row: string, column: string, expected: string): void => {
  expect(
    cell(table, row, column),
    `docs/design-doc.md table "${table.section}", row "${row}", column "${column}"`,
  ).toBe(expected);
};

/**
 * Matches one sentence of a section and compares its captured numbers (or
 * words) with the constants, in order.
 */
const expectSentence = (
  name: string,
  pattern: RegExp,
  expected: readonly (string | number)[],
): void => {
  const match = pattern.exec(prose(section(name)));
  if (match === null) {
    throw new Error(`docs/design-doc.md section "${name}": no sentence matches ${pattern}`);
  }
  expect(match.slice(1), `docs/design-doc.md section "${name}", sentence ${pattern}`).toEqual(
    expected.map(String),
  );
};

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
const word = (n: number): string => WORDS[n] ?? String(n);
const percent = (fraction: number): string => String(Math.round(fraction * 100));
const seconds = (s: number): string => `${s} s`;
const orNone = (value: number, unit: string): string => (value === 0 ? 'none' : `${value} ${unit}`);
const shotsToKill = (kind: EnemyKind, damagePerShot: number): number =>
  Math.ceil(ENEMY_STATS[kind].maxHealth / damagePerShot);

describe('design-doc.md simulation model', () => {
  it('quotes the player constants', () => {
    expectSentence(
      'simulation',
      /speed (\S+) m\/s \((\S+) when sprinting forward\), gravity (\S+) m\/s², jump impulse (\S+) m\/s/,
      [PLAYER_SPEED, PLAYER_SPRINT_SPEED, GRAVITY, PLAYER_JUMP_SPEED],
    );
    expectSentence('simulation', /\(radius (\S+) m, height (\S+) m, eye at (\S+) m\)/, [
      PLAYER_RADIUS,
      PLAYER_HEIGHT,
      PLAYER_EYE_HEIGHT,
    ]);
  });

  it('quotes the rifle', () => {
    const rifle = WEAPON_SPECS.rifle;
    expectSentence(
      'simulation',
      /holds (\S+) rounds with (\S+) in reserve, fires every (\S+) s for (\S+) damage with (\S+) m range, and reloads in (\S+) s/,
      [
        rifle.magazineSize,
        rifle.reserve,
        rifle.fireInterval,
        rifle.damage,
        rifle.range,
        rifle.reloadTime,
      ],
    );
    expectSentence('simulation', /Spread is (\S+) rad standing and (\S+) rad moving/, [
      rifle.spreadStanding,
      rifle.spreadMoving,
    ]);
  });

  it('quotes the grenade', () => {
    expectSentence(
      'simulation',
      /(\w+) per life\. Thrown at (\S+) m\/s plus a (\S+) m\/s upward boost, (\S+) s fuse, gravity (\S+) m\/s², (\S+) % restitution/,
      [
        word(STARTING_GRENADES).replace(/^\w/, (c) => c.toUpperCase()),
        GRENADE_THROW_SPEED,
        2,
        GRENADE_FUSE,
        GRENADE_GRAVITY,
        percent(GRENADE_RESTITUTION),
      ],
    );
    expectSentence(
      'simulation',
      /deals (\S+) damage at the cent(?:re|er) falling linearly to zero at (\S+) m/,
      [GRENADE_MAX_DAMAGE, GRENADE_BLAST_RADIUS],
    );
  });

  it('quotes spawning, bolts, waves and vitality', () => {
    expectSentence('simulation', /Spawning lasts (\S+) s/, [SPAWN_DELAY]);
    expectSentence('simulation', /travel at (\S+) m\/s for up to (\S+) s/, [
      BOLT_SPEED,
      BOLT_LIFETIME,
    ]);
    expectSentence(
      'simulation',
      /A (\S+) s countdown, an active phase until all enemies are dead, a (\S+) s cleared pause, then the next wave\. Wave (\d+) cleared is victory/,
      [WAVE_COUNTDOWN, WAVE_CLEAR_PAUSE, FINAL_WAVE],
    );
    const fresh = createVitality();
    expectSentence('simulation', /the shield first \((\d+)\), then health \((\d+)\)/, [
      fresh.shield,
      fresh.health,
    ]);
    expectSentence('simulation', /recharges at (\S+)\/s after (\S+) s without damage/, [
      SHIELD_RECHARGE_RATE,
      SHIELD_RECHARGE_DELAY,
    ]);
  });
});

describe('design-doc.md enemy archetypes', () => {
  const table = parseTable('enemies');
  const rows: readonly (readonly [string, EnemyKind])[] = [
    ['Skimmer', 'skimmer'],
    ['Strider', 'strider'],
  ];

  it('lists every archetype once', () => {
    expect(table.rows.map((r) => r[0])).toEqual(rows.map(([label]) => label));
  });

  it.each(rows)('matches ENEMY_STATS for the %s', (label, kind) => {
    const stats = ENEMY_STATS[kind];
    expectCell(table, label, 'Health', String(stats.maxHealth));
    expectCell(table, label, 'Speed', `${stats.speed} m/s`);
    expectCell(table, label, 'Score', String(stats.score));
    const attack = cell(table, label, 'Attack');
    expect(attack, `docs/design-doc.md table "enemies", row "${label}", column "Attack"`).toBe(
      `${stats.ranged ? 'Bolt' : 'Melee zap'}, ${stats.damage} dmg every ${stats.attackInterval} s`,
    );
    const behaviour = cell(table, label, 'Behavior');
    const where = `docs/design-doc.md table "enemies", row "${label}", column "Behavior"`;
    if (stats.ranged) {
      // Striders back off inside half their attack range (see updateEnemy).
      expect(/^Holds (\S+) to (\S+) m/.exec(behaviour)?.slice(1), where).toEqual([
        String(stats.attackRange * 0.5),
        String(stats.attackRange),
      ]);
    } else {
      expect(/^Closes to (\S+) m/.exec(behaviour)?.slice(1), where).toEqual([
        String(stats.attackRange),
      ]);
    }
  });

  it('quotes the rifle shots to kill', () => {
    const damage = WEAPON_SPECS.rifle.damage;
    expectSentence('enemies', /kills a skimmer in (\w+) shots? and a strider in (\w+)\./, [
      word(shotsToKill('skimmer', damage)),
      word(shotsToKill('strider', damage)),
    ]);
  });
});

describe('design-doc.md rout', () => {
  const table = parseTable('rout');

  it('quotes the flee radius', () => {
    expectSentence('rout', /every skimmer within (\S+) m of it \(`FLEE_RADIUS`/, [FLEE_RADIUS]);
    expectCell(table, 'Radius', 'Value', `${FLEE_RADIUS} m`);
  });

  it('quotes the flee duration and speed', () => {
    expectCell(table, 'Duration', 'Value', `${FLEE_DURATION} s (\`FLEE_DURATION\`)`);
    expectCell(table, 'Second strider death', 'Value', `refreshes the ${FLEE_DURATION} s`);
    const fleeSpeed = ENEMY_STATS.skimmer.speed * FLEE_SPEED_FACTOR;
    expectCell(
      table,
      'Speed',
      'Value',
      `${FLEE_SPEED_FACTOR}x (${Number(fleeSpeed.toFixed(2))} m/s)`,
    );
  });
});

describe('design-doc.md weapons', () => {
  const table = parseTable('weapons');

  it('lists every kind once, in WEAPON_KINDS order', () => {
    expect(table.rows.map((r) => r[0])).toEqual(WEAPON_KINDS.map((k) => WEAPON_SPECS[k].name));
  });

  it('quotes the falloff floor and minigun idle rate', () => {
    expectSentence('weapons', /(\d+) % of full \(`FALLOFF_FLOOR`\)/, [percent(FALLOFF_FLOOR)]);
    expectSentence('weapons', /fires at (\d+) % of its full rate \(`MINIGUN_IDLE_RATE`\)/, [
      percent(MINIGUN_IDLE_RATE),
    ]);
  });

  it.each(WEAPON_KINDS.map((k): [string, WeaponSpec] => [WEAPON_SPECS[k].name, WEAPON_SPECS[k]]))(
    'matches WEAPON_SPECS for the %s',
    (label, spec) => {
      expectCell(table, label, 'Magazine', String(spec.magazineSize));
      expectCell(table, label, 'Reserve', String(spec.reserve));
      expectCell(table, label, 'Fire interval', seconds(spec.fireInterval));
      expectCell(table, label, 'Reload', seconds(spec.reloadTime));
      expectCell(
        table,
        label,
        'Damage',
        spec.pellets > 1 ? `${spec.damage} per pellet` : String(spec.damage),
      );
      expectCell(table, label, 'Range', `${spec.range} m`);
      expectCell(table, label, 'Spread', `${spec.spreadStanding} / ${spec.spreadMoving}`);
      expectCell(table, label, 'Pellets', String(spec.pellets));
      expectCell(
        table,
        label,
        'Falloff',
        spec.falloffStart === spec.falloffEnd
          ? 'none'
          : `${spec.falloffStart} to ${spec.falloffEnd} m`,
      );
      expectCell(table, label, 'Charge', orNone(spec.chargeTime, 's'));
      expectCell(table, label, 'Spin-up', orNone(spec.spinUp, 's'));
      expectCell(table, label, 'Projectile', spec.projectile ? 'yes' : 'no');
    },
  );

  it('quotes the per-weapon notes', () => {
    const laser = WEAPON_SPECS.laser;
    expectSentence('weapons', /(\w+) shot kills a skimmer and (\w+) kill a strider/, [
      word(shotsToKill('skimmer', laser.damage)),
      word(shotsToKill('strider', laser.damage)),
    ]);
    const scatter = WEAPON_SPECS.scatter;
    expectSentence(
      'weapons',
      /(\w+) pellets that delete a skimmer in one shot inside (\S+) m and do almost nothing past (\S+) m/,
      [
        word(scatter.pellets).replace(/^\w/, (c) => c.toUpperCase()),
        scatter.falloffStart,
        scatter.falloffEnd,
      ],
    );
    expect(
      scatter.pellets * scatter.damage,
      'a full scatter volley kills a skimmer',
    ).toBeGreaterThanOrEqual(ENEMY_STATS.skimmer.maxHealth);
    expectSentence('weapons', /Hold to charge for (\S+) s/, [WEAPON_SPECS.beam.chargeTime]);
    expectSentence('weapons', /bursts on contact with a (\S+) m blast/, [ROUND_BLAST_RADIUS]);
    expectSentence('weapons', /A single (\d+)-round belt with no reserve/, [
      WEAPON_SPECS.minigun.magazineSize,
    ]);
  });
});

describe('design-doc.md wave composition', () => {
  const table = parseTable('waves');

  it('quotes the spawn ring and the clear bonus', () => {
    expectSentence('waves', /on a (\S+) m ring around the arena cent(?:re|er)/, [
      SPAWN_RING_RADIUS,
    ]);
    expectSentence('waves', /Clearing a wave is worth (\d+)\./, [WAVE_BONUS]);
    expectSentence('waves', /The roster for the (\w+) waves/, [word(FINAL_WAVE)]);
  });

  it('has one row per wave up to FINAL_WAVE', () => {
    expect(table.rows.map((r) => r[0])).toEqual(
      Array.from({ length: FINAL_WAVE }, (_, i) => String(i + 1)),
    );
  });

  it.each(Array.from({ length: FINAL_WAVE }, (_, i) => i + 1))(
    'matches waveComposition(%i)',
    (wave) => {
      const roster = waveComposition(wave);
      const count = (kind: EnemyKind): string => String(roster.filter((k) => k === kind).length);
      expectCell(table, String(wave), 'Skimmers', count('skimmer'));
      expectCell(table, String(wave), 'Striders', count('strider'));
    },
  );
});

describe('design-doc.md arena', () => {
  it('quotes the arena size and block count', () => {
    const blocks = generateArena(createRng(1)).obstacles.length;
    expectSentence(
      'arena',
      /A (\d+) m square with transparent boundary walls and (\d+) procedurally placed cover blocks/,
      [ARENA_HALF_SIZE * 2, blocks],
    );
  });
});

describe('design-doc.md atmosphere', () => {
  it('lists ATMOSPHERE_TABLE wave by wave', () => {
    // Anchored on the constant's name rather than a marker: the sentence
    // sits in a Presentation bullet that is edited independently.
    const pattern = /`ATMOSPHERE_TABLE`: (.+?), then the table repeats/;
    const match = pattern.exec(prose(doc));
    if (match === null) {
      throw new Error(`docs/design-doc.md: no sentence matches ${pattern}`);
    }
    const expected = ATMOSPHERE_TABLE.map(
      (a, i) => `${i + 1} ${a.timeOfDay}${a.weather === 'clear' ? '' : ` and ${a.weather}`}`,
    ).join(', ');
    expect(match[1], 'docs/design-doc.md, the ATMOSPHERE_TABLE sentence').toBe(expected);
  });
});
