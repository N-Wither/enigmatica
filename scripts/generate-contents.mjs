import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

async function removeTemporary(directory, parent, prefix) {
  const resolved = path.resolve(directory)
  if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error('Refusing to remove unexpected temporary directory: ' + resolved)
  }
  await rm(resolved, { recursive: true, force: true })
}

async function entriesIn(directory, entries = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) await entriesIn(filename, entries)
    else if (entry.isFile() && /\.(js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) entries.push(filename)
    else if (entry.isSymbolicLink()) throw new Error('Generator symlinks are unsupported: ' + filename)
  }
  return entries
}

/** Compile and validate every script before publishing any generated content. */
export async function generateContents({
  generatorRoot = path.join(projectRoot, 'src/generator'),
  contentsRoot = path.join(projectRoot, 'src/contents'),
} = {}) {
  let entries
  try { entries = await entriesIn(generatorRoot) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  entries.sort((a, b) => {
    const left = path.relative(generatorRoot, a).split(path.sep).join('/')
    const right = path.relative(generatorRoot, b).split(path.sep).join('/')
    return left < right ? -1 : left > right ? 1 : 0
  })
  if (!entries.length) return []
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'enigmatica-contents-'))
  const groups = new Map()
  const staged = []
  try {
    for (const [index, filename] of entries.entries()) {
      try {
        const directory = path.relative(generatorRoot, path.dirname(filename))
        if (!directory) throw new Error('Place generator entries in a content subdirectory')
        const compiled = path.join(temporary, index + '.mjs')
        await build({ entryPoints: [filename], outfile: compiled, bundle: true,
          platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' })
        const module = await import(pathToFileURL(compiled).href)
        if (!Object.hasOwn(module, 'default')) throw new Error('Missing default export')
        const exported = module.default
        const records = Array.isArray(exported) ? exported : [exported]
        const group = groups.get(directory) ?? { records: [], ids: new Set() }
        for (const record of records) {
          if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new Error('Default export must be a record or an array of records')
          }
          const plain = JSON.parse(JSON.stringify(record))
          if (!plain || typeof plain !== 'object' || Array.isArray(plain)) throw new Error('Serialized content must be a record')
          if (Object.hasOwn(plain, 'id')) {
            if (typeof plain.id !== 'string' || !plain.id) throw new Error('Content id must be a nonempty string')
            if (group.ids.has(plain.id)) throw new Error('Duplicate content id: ' + plain.id)
            group.ids.add(plain.id)
          }
          group.records.push(plain)
        }
        groups.set(directory, group)
      } catch (error) {
        throw new Error('Content generator failed: ' + path.relative(generatorRoot, filename) + '\n' + (error instanceof Error ? error.message : String(error)), { cause: error })
      }
    }
    for (const [directory, group] of groups) {
      const category = path.basename(directory)
      const destination = path.join(contentsRoot, directory, category === 'item' ? 'metadata.json' : category + 's.json')
      const body = JSON.stringify(group.records, null, 2) + '\n'
      let previous
      try { previous = await readFile(destination, 'utf8') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (body === previous) continue
      await mkdir(path.dirname(destination), { recursive: true })
      // Stage beside the destination so rename stays on the same filesystem.
      const stagingDirectory = await mkdtemp(path.join(path.dirname(destination), '.generate-contents-'))
      const stagingFile = path.join(stagingDirectory, 'content.json')
      staged.push({ destination, stagingDirectory, stagingFile })
      await writeFile(stagingFile, body)
    }
    for (const entry of staged) await rename(entry.stagingFile, entry.destination)
    return staged.map(entry => entry.destination)
  } finally {
    try {
      for (const entry of staged) await removeTemporary(entry.stagingDirectory, path.dirname(entry.destination), '.generate-contents-')
    } finally {
      await removeTemporary(temporary, os.tmpdir(), 'enigmatica-contents-')
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log('Generated ' + (await generateContents()).length + ' content file(s)') }
  catch (error) { console.error(error); process.exitCode = 1 }
}
