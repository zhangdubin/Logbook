/**
 * scripts/publish-deploy-asset.mjs —— 把「生产环境部署版本」上传为 GitHub Release 的附加附件
 *
 * 同一个 Release 下挂两个附件：
 *   cuoti-analytics-v1.0.0.tar.gz            源码包（做 Git 历史、二次开发）
 *   cuoti-analytics-v1.0.0-deploy.tar.gz     部署版本（含已构建的 dist/，服务器直接跑）
 *
 * install.sh 会优先找部署版本，找不到就退回源码包在服务器上现场构建。
 */

import fs from 'node:fs'
import path from 'node:path'
import { request } from '../server/httpClient.js'

const API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com'
const UPLOAD_BASE =
  process.env.GITHUB_UPLOAD_BASE ||
  (API_BASE.includes('api.github.com') ? 'https://uploads.github.com' : API_BASE)

/**
 * 上传部署包到指定 Release。
 * @param {{repo: string, version: string, file: string, token: string, proxyUrl?: string, notes?: string}} opts
 */
export async function publishDeployAsset({
  repo,
  version,
  file,
  token,
  proxyUrl = '',
  notes = '',
}) {
  const [owner, name] = String(repo).split('/')
  if (!owner || !name) throw new Error('仓库地址格式不正确，应为 owner/repo')
  if (!token) throw new Error('缺少 GITHUB_TOKEN')

  const tag = `v${version}`
  const assetName = path.basename(file)
  const buffer = fs.readFileSync(file)

  // 1) 找到（或创建）Release
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cuoti-analytics',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
  }

  const listRes = await request(`${API_BASE}/repos/${owner}/${name}/releases`, {
    headers,
    proxyUrl,
    timeoutMs: 30_000,
  })
  let release = (JSON.parse(listRes.body.toString('utf8')) || []).find(
    (r) => r.tag_name === tag,
  )

  if (!release) {
    console.log(`  · Release ${tag} 不存在，创建中…`)
    const createRes = await request(`${API_BASE}/repos/${owner}/${name}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body: notes || `发布 ${tag}`,
        prerelease: false,
        draft: false,
      }),
      proxyUrl,
      timeoutMs: 30_000,
    })
    if (createRes.status < 200 || createRes.status >= 300) {
      throw new Error(`创建 Release 失败：HTTP ${createRes.status} ${createRes.body.toString('utf8').slice(0, 300)}`)
    }
    release = JSON.parse(createRes.body.toString('utf8'))
  }

  // 2) 同名附件已存在就删掉重传
  const existing = (release.assets || []).find((a) => a.name === assetName)
  if (existing) {
    console.log(`  · 删除同名旧附件 ${assetName}`)
    await request(`${API_BASE}/repos/${owner}/${name}/releases/assets/${existing.id}`, {
      method: 'DELETE',
      headers,
      proxyUrl,
      timeoutMs: 30_000,
    })
  }

  // 3) 上传
  console.log(`  · 上传 ${assetName}（${(buffer.length / 1024 / 1024).toFixed(2)} MB）…`)
  const uploadRes = await request(
    `${UPLOAD_BASE}/repos/${owner}/${name}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cuoti-analytics',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/gzip',
        'Content-Length': String(buffer.length),
      },
      body: buffer,
      proxyUrl,
      timeoutMs: 10 * 60 * 1000,
    },
  )
  if (uploadRes.status < 200 || uploadRes.status >= 300) {
    throw new Error(`上传失败：HTTP ${uploadRes.status} ${uploadRes.body.toString('utf8').slice(0, 300)}`)
  }

  console.log(`  \x1b[32m✓\x1b[0m 已附加到 Release ${tag}`)
  console.log(`    ${release.html_url}`)

  // 4) 顺带上传 sha256 校验文件（install.sh 会用它校验下载完整性）
  const shaFile = `${file}.sha256`
  if (fs.existsSync(shaFile)) {
    const shaName = path.basename(shaFile)
    const old = (release.assets || []).find((a) => a.name === shaName)
    if (old) {
      await request(`${API_BASE}/repos/${owner}/${name}/releases/assets/${old.id}`, {
        method: 'DELETE',
        headers,
        proxyUrl,
        timeoutMs: 30_000,
      })
    }
    const shaBuf = fs.readFileSync(shaFile)
    const up = await request(
      `${UPLOAD_BASE}/repos/${owner}/${name}/releases/${release.id}/assets?name=${encodeURIComponent(shaName)}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cuoti-analytics',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
          'Content-Length': String(shaBuf.length),
        },
        body: shaBuf,
        proxyUrl,
        timeoutMs: 60_000,
      },
    )
    if (up.status >= 200 && up.status < 300) {
      console.log(`  \x1b[32m✓\x1b[0m 校验文件 ${shaName}`)
    } else {
      console.log(`  \x1b[33m!\x1b[0m 校验文件上传失败：HTTP ${up.status}`)
    }
  }

  return { ok: true, assetName, size: buffer.length, releaseUrl: release.html_url }
}

export default { publishDeployAsset }
