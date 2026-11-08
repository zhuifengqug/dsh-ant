#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { scaffoldFiles, seedPlan, seedMembers, teamCreateRequest, PLACEHOLDER } from '../src/core/template.mjs';
import { validatePlan } from '../src/core/plan.mjs';

const USAGE = `用法: node tools/ant-scaffold.mjs [选项]

  --target <dir>    目标目录（默认 ./<name>）
  --name <name>     仓库名，同时是团队名（必填）
  --scope <scope>   npm scope，生成 @scope/name 形式的包名
  --summary <text>  一句话目标，写进 README/AGENTS
  --lang <node|none>  默认 node
  --force           目标目录非空时仍然写入；只覆盖模板自己的文件，不动别的
  --help            显示本帮助

标准输出是一份 teamCreateRequest 的 JSON，用 ant_team_dispatch 提交即可建队。`;

function parse(argv) {
  const options = { lang: 'node', force: false };
  const takesValue = new Set(['target', 'name', 'scope', 'summary', 'lang']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') return { help: true };
    if (token === '--force') { options.force = true; continue; }
    if (!token.startsWith('--')) throw new Error('无法识别的参数: ' + token);
    const key = token.slice(2);
    if (!takesValue.has(key)) throw new Error('未知选项: ' + token);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error('选项缺少取值: ' + token);
    options[key] = value;
    index += 1;
  }
  return options;
}

function entriesOf(dir) {
  try { return fs.readdirSync(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function isDirectory(dest) {
  try { return fs.statSync(dest).isDirectory(); } catch { return false; }
}

function writeAtomic(dest, contents) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, dest);
}

function main(argv) {
  const options = parse(argv);
  if (options.help) { process.stdout.write(USAGE + '\n'); return 0; }
  if (!options.name) throw new Error('缺少 --name');
  const seed = { name: options.name, scope: options.scope, summary: options.summary, lang: options.lang };
  const files = scaffoldFiles(seed);
  const stale = new RegExp(PLACEHOLDER.source, 'i');
  const leftovers = files.filter(file => stale.test(file.contents));
  if (leftovers.length) throw new Error('模板残留占位符: ' + leftovers.map(file => file.path).join(', '));
  validatePlan(seedPlan(seed), seedMembers());

  const target = path.resolve(options.target ?? options.name);
  const existing = entriesOf(target);
  if (existing.length && !options.force) {
    const collisions = files.map(file => file.path).filter(item => fs.existsSync(path.join(target, item)));
    process.stderr.write('目标目录非空: ' + target + '\n');
    for (const entry of collisions) process.stderr.write('  撞名: ' + entry + '\n');
    process.stderr.write('加 --force 才会写入；模板文件会被覆盖，其它文件不动。\n');
    return 2;
  }

  const written = [], skipped = [];
  for (const file of files) {
    const dest = path.join(target, file.path);
    if (isDirectory(dest)) { skipped.push(file.path); continue; }
    writeAtomic(dest, file.contents);
    written.push(file.path);
  }
  const covered = new Set(written.map(item => item.split('/')[0]));
  for (const entry of existing) if (!covered.has(entry)) skipped.push(entry);

  process.stderr.write('已生成 ' + written.length + ' 个文件于 ' + target + '\n');
  for (const item of written) process.stderr.write('  + ' + item + '\n');
  if (skipped.length) { process.stderr.write('未动 ' + skipped.length + ' 项: ' + skipped.join(', ') + '\n'); }
  process.stderr.write('\n下一步: cd ' + target + ' && git init\n');
  process.stdout.write(JSON.stringify(teamCreateRequest(seed), null, 2) + '\n');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write('ant-scaffold: ' + (error?.message ?? error) + '\n');
  process.exitCode = 1;
}
