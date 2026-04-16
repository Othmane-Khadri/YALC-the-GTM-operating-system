import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { getSkillsDir } from './loader'
import type { SkillManifest, SkillSource, InstallResult, RemoteSkillInfo } from './types'

const GITHUB_API = 'https://api.github.com'
const SKILL_REPO_PREFIX = 'gtm-os-skill-'

export class MarketplaceRegistry {
  async search(query: string): Promise<RemoteSkillInfo[]> {
    const searchQuery = `${SKILL_REPO_PREFIX}${query} in:name,description`
    const res = await fetch(`${GITHUB_API}/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&per_page=20`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) throw new Error(`GitHub search failed: ${res.status}`)
    const data = (await res.json()) as { items: GitHubRepo[] }
    return data.items.map(repoToSkillInfo)
  }

  async browse(category?: string): Promise<RemoteSkillInfo[]> {
    const query = category
      ? `${SKILL_REPO_PREFIX} ${category} in:name,description`
      : `${SKILL_REPO_PREFIX} in:name`
    const res = await fetch(`${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=50`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) throw new Error(`GitHub browse failed: ${res.status}`)
    const data = (await res.json()) as { items: GitHubRepo[] }
    return data.items.map(repoToSkillInfo)
  }

  async install(source: SkillSource): Promise<InstallResult> {
    if (source.type === 'github') return this.installFromGitHub(source.repo, source.ref ?? 'main')
    if (source.type === 'local') return this.installFromLocal(source.path)
    throw new Error(`Source type "${source.type}" not yet supported. Use github or local.`)
  }

  async uninstall(skillId: string): Promise<void> {
    const skillDir = join(getSkillsDir(), skillId)
    await rm(skillDir, { recursive: true, force: true })
  }

  private async installFromGitHub(repo: string, ref: string): Promise<InstallResult> {
    const rawBase = `https://raw.githubusercontent.com/${repo}/${ref}`
    const manifestRes = await fetch(`${rawBase}/skill.json`)
    if (!manifestRes.ok) return { success: false, skillId: '', version: '', installPath: '', message: `No skill.json found in ${repo}` }
    const manifest = (await manifestRes.json()) as SkillManifest

    const mainFile = manifest.main ?? 'index.ts'
    const mainRes = await fetch(`${rawBase}/${mainFile}`)
    if (!mainRes.ok) return { success: false, skillId: manifest.id, version: manifest.version, installPath: '', message: `Main module ${mainFile} not found in ${repo}` }
    const mainContent = await mainRes.text()

    const installDir = join(getSkillsDir(), manifest.id)
    await mkdir(installDir, { recursive: true })
    await writeFile(join(installDir, 'skill.json'), JSON.stringify(manifest, null, 2))
    await writeFile(join(installDir, mainFile), mainContent)

    return { success: true, skillId: manifest.id, version: manifest.version, installPath: installDir, message: `Installed ${manifest.name} v${manifest.version} from ${repo}` }
  }

  private async installFromLocal(sourcePath: string): Promise<InstallResult> {
    const { readFile, cp } = await import('fs/promises')
    const manifestRaw = await readFile(join(sourcePath, 'skill.json'), 'utf-8')
    const manifest = JSON.parse(manifestRaw) as SkillManifest
    const installDir = join(getSkillsDir(), manifest.id)
    await mkdir(installDir, { recursive: true })
    await cp(sourcePath, installDir, { recursive: true })
    return { success: true, skillId: manifest.id, version: manifest.version, installPath: installDir, message: `Installed ${manifest.name} v${manifest.version} from local path` }
  }
}

interface GitHubRepo { name: string; full_name: string; description: string; html_url: string; stargazers_count: number; owner: { login: string } }

function repoToSkillInfo(repo: GitHubRepo): RemoteSkillInfo {
  return {
    id: repo.name.replace(SKILL_REPO_PREFIX, '') || repo.name,
    name: repo.name, version: 'latest', description: repo.description ?? '',
    category: 'integration', author: `@${repo.owner.login}`,
    downloads: repo.stargazers_count, repository: repo.html_url, requiredProviders: [],
  }
}
