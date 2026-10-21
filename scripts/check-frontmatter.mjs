// Validates the YAML frontmatter of every tracked Markdown file under docs/ against docs/frontmatter.schema.json. Adapted from the crefft
// specifications guide (guides/docs/specifications.md, "Frontmatter
// Validation") at commit 6e6481840e68a89874e0d90eaae3cf23e83379fb.
//
// The `yaml` parser follows the YAML 1.2 core schema, so `created: 2026-10-21`
// stays a string and the schema's date pattern applies.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';

const schema = JSON.parse(readFileSync('docs/frontmatter.schema.json', 'utf8'));
const validate = new Ajv2020({ allErrors: true }).compile(schema);
const files = execFileSync('git', ['ls-files', '-z', '--', 'docs/*.md'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

let failures = 0;
for (const file of files) {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'));
  if (!matched) {
    console.error(`${file}: missing YAML frontmatter`);
    failures += 1;
  } else if (!validate(parse(matched[1]))) {
    for (const error of validate.errors) {
      console.error(`${file}: ${error.instancePath || '/'} ${error.message}`);
    }
    failures += 1;
  }
}

console.log(`${files.length - failures} of ${files.length} documents have valid frontmatter`);
process.exit(failures === 0 ? 0 : 1);
