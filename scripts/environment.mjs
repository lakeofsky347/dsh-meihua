// Shared, read-only environment discovery. Overrides always take precedence.
import { existsSync, lstatSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const resolveProjectRoot = moduleURL => path.resolve(path.dirname(fileURLToPath(moduleURL)), '..');

function context(options = {}) {
  const platform = options.platform ?? process.platform;
  return { platform, paths: platform === 'win32' ? path.win32 : path.posix,
    env: options.env ?? process.env, home: options.home ?? homedir(),
    root: options.root ?? process.cwd(), exists: options.exists ?? existsSync };
}
function configured(value, ctx) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  return ctx.paths.resolve(ctx.root, /^~[\\/]/.test(text) ? ctx.paths.join(ctx.home, text.slice(2)) : text);
}
export function resolveReference(options = {}) {
  const ctx = context(options), reference = configured(ctx.env.DSH_REFERENCE, ctx) ?? ctx.paths.resolve(ctx.root, '../dsh_clone');
  if (!ctx.exists(ctx.paths.join(reference, 'package.json'))) throw new Error('Reference tools were not found. Set DSH_REFERENCE to a prepared dsh_clone checkout.');
  return reference;
}
export function resourceCandidates(options = {}) {
  const ctx = context(options), join = ctx.paths.join;
  if (ctx.platform === 'darwin') return [join(ctx.home, 'Applications/DeepSeek Harness.app/Contents/Resources'), '/Applications/DeepSeek Harness.app/Contents/Resources'];
  if (ctx.platform === 'win32') return [
    ctx.env.LOCALAPPDATA && join(ctx.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources'),
    ctx.env.ProgramFiles && join(ctx.env.ProgramFiles, 'DeepSeek Harness', 'resources'),
    ctx.env['ProgramFiles(x86)'] && join(ctx.env['ProgramFiles(x86)'], 'DeepSeek Harness', 'resources'),
  ].filter(Boolean);
  return ['/opt/DeepSeek Harness/resources', '/opt/deepseek-harness/resources', '/usr/lib/deepseek-harness/resources', '/usr/share/deepseek-harness/resources'];
}
export function resolveDshResources(options = {}) {
  const ctx = context(options), explicit = configured(ctx.env.DSH_RESOURCES, ctx);
  if (explicit) {
    if (!ctx.exists(ctx.paths.join(explicit, 'app.asar'))) throw new Error('DSH_RESOURCES must contain the installed app.asar.');
    return explicit;
  }
  return resourceCandidates(options).find(directory => ctx.exists(ctx.paths.join(directory, 'app.asar')));
}
export function resolveRuntimeSource(options = {}) {
  const ctx = context(options), runtime = configured(ctx.env.DSH_RUNTIME, ctx);
  if (runtime) {
    if (!ctx.exists(ctx.paths.join(runtime, 'package.json')) || !ctx.exists(ctx.paths.join(runtime, 'node_modules'))) throw new Error('DSH_RUNTIME must be a complete released runtime directory with package.json and node_modules.');
    return { kind: 'directory', root: runtime };
  }
  const resources = resolveDshResources(options);
  if (!resources) throw new Error('No installed DSH runtime was found. Set DSH_RESOURCES to Desktop resources or DSH_RUNTIME to a complete released runtime directory.');
  return { kind: 'asar', resources, archive: ctx.paths.join(resources, 'app.asar') };
}
export function resolveDshCli(options = {}) {
  const ctx = context(options), join = ctx.paths.join;
  const names = ctx.platform === 'win32' ? ['dsh.exe', 'dsh.cmd', 'dsh.bat'] : ['dsh'];
  const fromPath = name => {
    const extensions = ctx.platform === 'win32' && !ctx.paths.extname(name) ? ['', '.exe', '.cmd', '.bat'] : [''];
    return (ctx.env.PATH ?? ctx.env.Path ?? '').split(ctx.platform === 'win32' ? ';' : ':').filter(Boolean)
      .flatMap(directory => extensions.map(extension => join(directory, name + extension))).find(ctx.exists);
  };
  const override = ctx.env.DSH_CLI?.trim();
  if (override) {
    const cli = /[\\/]/.test(override) ? configured(override, ctx) : fromPath(override);
    if (!cli || !ctx.exists(cli)) throw new Error('DSH_CLI does not identify an existing official dsh launcher.');
    return cli;
  }
  const resources = resolveDshResources(options), runtime = configured(ctx.env.DSH_RUNTIME, ctx);
  const candidates = [
    ...(resources ? names.map(name => join(resources, 'runtime', 'cli', 'bin', name)) : []),
    ...(runtime ? ['cli/bin', 'bin', 'node_modules/.bin'].flatMap(directory => names.map(name => join(runtime, directory, name))) : []),
  ];
  const cli = candidates.find(ctx.exists) ?? names.map(fromPath).find(Boolean);
  if (!cli) throw new Error('No official dsh launcher was found. Set DSH_CLI to its path.');
  return cli;
}

/** Windows command launchers need cmd.exe; quoting must keep paths as one argument. */
export function cliInvocation(cli, args, options = {}) {
  const ctx = context(options);
  if (/\.[cm]?js$/i.test(cli)) return { command: options.node ?? process.execPath, args: [cli, ...args], options: {} };
  if (ctx.platform === 'win32' && /\.(?:cmd|bat)$/i.test(cli)) {
    const values = [cli, ...args];
    if (values.some(value => /[\r\n"%]/.test(value))) throw new Error('Windows CLI launcher paths and arguments cannot contain quotes, percent signs or newlines. Use a plain installation/preview path.');
    const commandLine = '"' + values.map(value => `"${value}"`).join(' ') + '"';
    return { command: ctx.env.ComSpec ?? ctx.env.COMSPEC ?? 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', commandLine], options: { windowsVerbatimArguments: true } };
  }
  return { command: cli, args, options: {} };
}

export function linkDirectory(target, destination, platform = process.platform) {
  symlinkSync(path.resolve(target), destination, platform === 'win32' ? 'junction' : 'dir');
}
function canonical(value) {
  let existing = path.resolve(value), suffix = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing)); existing = parent;
  }
  return path.resolve(realpathSync(existing), ...suffix);
}
export function resolvePreviewHome(root, env = process.env, home = homedir()) {
  const destination = path.resolve(root, env.DSH_PREVIEW_HOME?.trim() || '.local/test-home');
  const allowed = canonical(path.join(root, '.local')), actual = canonical(destination);
  const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);
  if (allowed !== path.join(canonical(root), '.local')) throw new Error('The checkout\'s .local directory must not resolve through a symlink outside the checkout.');
  if (actual === allowed || !within(allowed, actual)) throw new Error('DSH_PREVIEW_HOME must be a dedicated directory inside this checkout\'s .local directory, without escaping through a symlink.');
  const everyday = [path.join(home, '.dsh'), ...(env.DSH_HOME?.trim() ? [path.resolve(env.DSH_HOME.trim())] : [])].map(canonical);
  if (everyday.some(directory => within(directory, actual) || within(actual, directory))) throw new Error('The preview directory overlaps a daily DSH home. Select a new dedicated directory inside .local.');
  return destination;
}
export function assertPreviewPath(home, filename) {
  const parent = canonical(home), child = canonical(filename);
  if (child !== parent && !child.startsWith(parent + path.sep)) throw new Error('The preview profile contains a symlink outside its dedicated home. Select a new dedicated preview directory.');
}
export function existingLinkTarget(destination) {
  try { return lstatSync(destination).isSymbolicLink() ? realpathSync(destination) : undefined; }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
