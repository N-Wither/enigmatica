import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export const sourceRoot = path.join(projectRoot, 'src')

// Keep empty directories too. Only TypeScript files go through esbuild.
async function scan(directory, files = [], directories = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      directories.push(filename)
      await scan(filename, files, directories)
    } else if (entry.isFile()) {
      files.push(filename)
    } else {
      throw new Error(`Unsupported source entry: ${filename}`)
    }
  }
  return { files, directories }
}

export async function buildProject({ development = false } = {}) {
  const outputRoot = path.join(projectRoot, development ? 'dev' : 'dist')
  const { files, directories } = await scan(sourceRoot)
  const entries = files.filter(filename => filename.endsWith('.ts'))
  const assets = files.filter(filename => !filename.endsWith('.ts'))
  // Compile before clearing output so a syntax error leaves the last build intact.
  const result = entries.length ? await build({
    absWorkingDir: projectRoot,
    entryPoints: entries,
    outbase: sourceRoot,
    outdir: outputRoot,
    entryNames: '[dir]/[name]',
    chunkNames: '_chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: development ? 'inline' : false,
    minify: !development,
    write: false,
    logLevel: 'silent',
  }) : { outputFiles: [] }

  const assetPaths = new Set(assets.map(filename => path.join(outputRoot, path.relative(sourceRoot, filename)).toLowerCase()))
  for (const output of result.outputFiles) {
    if (assetPaths.has(output.path.toLowerCase())) {
      throw new Error(`Compiled output conflicts with a source asset: ${output.path}`)
    }
  }
  // outputRoot is always the fixed dev/ or dist/ directory under this project.
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })
  for (const directory of directories) {
    await mkdir(path.join(outputRoot, path.relative(sourceRoot, directory)), { recursive: true })
  }
  await Promise.all(assets.map(filename => cp(filename, path.join(outputRoot, path.relative(sourceRoot, filename)))))
  await Promise.all(result.outputFiles.map(async output => {
    await mkdir(path.dirname(output.path), { recursive: true })
    await writeFile(output.path, output.contents)
  }))
  return outputRoot
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Built: ${await buildProject()}`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
