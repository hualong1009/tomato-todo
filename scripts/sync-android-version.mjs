#!/usr/bin/env node
/**
 * 把 package.json 的 version（x.y.z）同步到 android/app/build.gradle：
 *   versionName "x.y.z"
 *   versionCode major * 10000 + minor * 100 + patch
 * 这样 APK、项目版本号、应用内版本始终一致。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
const version = String(pkg.version ?? '')
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
if (!match) {
  console.error(`package.json 的 version 必须是 x.y.z 格式，当前是「${version}」`)
  process.exit(1)
}

const versionCode = Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3])
const gradlePath = new URL('../android/app/build.gradle', import.meta.url)
let gradle = readFileSync(gradlePath, 'utf-8')

const before = gradle
gradle = gradle.replace(/versionCode \d+\n(\s*)versionName "[^"]+"/, `versionCode ${versionCode}\n$1versionName "${version}"`)

if (gradle === before) {
  console.error('android/app/build.gradle 中没有找到 versionCode / versionName，请检查格式')
  process.exit(1)
}
writeFileSync(gradlePath, gradle)
console.log(`已同步版本：package.json ${version} → Android versionName ${version} / versionCode ${versionCode}`)
