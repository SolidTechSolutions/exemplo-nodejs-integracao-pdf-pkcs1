'use strict'
/**
 * [EN]    PAdES (PDF) signing — PKCS#1 two-step flow (browser extension / external key).
 *         Step 1: preparePdf  → returns raw JSON from SolidSign (hashes + finalNonce).
 *         Step 2: finalizePdf → receives signed hashes, returns ZIP buffer.
 * [PT-BR] Assinatura PAdES (PDF) — fluxo PKCS#1 em dois passos (extensão de navegador).
 *         Passo 1: preparePdf  → retorna JSON bruto do SolidSign (hashes + finalNonce).
 *         Passo 2: finalizePdf → recebe hashes assinados, retorna buffer ZIP.
 */
const JSZip = require('jszip')

/**
 * Step 1 — Preparation
 * @returns {Promise<object|null>}  Raw SolidSign JSON to forward to the browser extension.
 */
async function preparePdf({ authorization, baseUrl, files, imageFiles = [], sigParams = {} }) {
  const form = new FormData()
  files.forEach(({ buffer, filename }, i) => form.append(`document[${i}]`, new Blob([buffer]), filename))
  imageFiles.forEach(({ buffer, filename }, i) => form.append(`signatureImage[${i}]`, new Blob([buffer]), filename))

  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') form.append(k, String(v)) }
  add('profile', sigParams.profile); add('hashAlgorithm', sigParams.hashAlgorithm); add('policyVersion', sigParams.policyVersion)
  add('sigFieldMeasurementUnit', sigParams.sigFieldMeasurementUnit); appendIndexedJson(form, 'signatureFieldConfig', sigParams.signatureFieldConfig)
  add('reason', sigParams.reason); add('location', sigParams.location); add('contact', sigParams.contact)
  add('signatureFieldName', sigParams.signatureFieldName); appendIndexedJson(form, 'signatureTextConfig', sigParams.signatureTextConfig)
  add('mdpPermissionLevel', sigParams.mdpPermissionLevel); add('passwordsForDecryption', sigParams.passwordsForDecryption)
  add('documentInfoMetadata', sigParams.documentInfoMetadata); appendIndexedJson(form, 'signatureQrCodeConfig', sigParams.signatureQrCodeConfig)

  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/solidsign/dsig/pdf/pkcs1/sign-preparation`, {
    method: 'POST',
    headers: { Authorization: authorization },
    body: form,
  })
  if (!resp.ok) { console.error(`SolidSign error ${resp.status}: ${await resp.text()}`); return null }
  return resp.json()
}

/**
 * Step 2 — Finalization
 * @param {string[]} [originalFileNames]  Optional — for ZIP entry naming.
 * @returns {Promise<Buffer|null>}         ZIP buffer.
 */
async function finalizePdf({ authorization, baseUrl, signedHashes, finalNonce, originalFileNames = [] }) {
  const form = new FormData()
  form.append('signedHashes', signedHashes)
  form.append('finalNonce', finalNonce)

  const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/solidsign/dsig/pdf/pkcs1/sign-finalization`, {
    method: 'POST',
    headers: { Authorization: authorization },
    body: form,
  })
  if (!resp.ok) { console.error(`SolidSign error ${resp.status}: ${await resp.text()}`); return null }

  const signResp = await resp.json()
  return downloadAndZip(signResp, originalFileNames, authorization)
}

async function downloadAndZip(signResp, originalNames, auth) {
  const zip = new JSZip()
  for (let i = 0; i < signResp.documents.length; i++) {
    const selfLink = signResp.documents[i]._links?.self || (signResp.documents[i].links || []).find(l => l.rel === 'self')
    if (!selfLink) continue
    const dlResp = await fetch(selfLink.href, { headers: { Authorization: auth } })
    if (!dlResp.ok) continue
    const name = originalNames[i] || `document_${i}.pdf`
    zip.file(`signed_${name}`, Buffer.from(await dlResp.arrayBuffer()))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

// [EN]    Sends a visual-signature config as INDEXED fields: key[0], key[1], ...
//         The SolidSign API expects signatureFieldConfig[0]={...} per document,
//         NOT a single signatureFieldConfig=[{...}] — otherwise the field is ignored
//         and the visual stamp never appears.
// [PT-BR] Envia a config de assinatura visual como campos INDEXADOS: key[0], key[1], ...
//         A API espera signatureFieldConfig[0]={...} por documento, e NÃO um único
//         signatureFieldConfig=[{...}] — senão o campo é ignorado e o carimbo não aparece.
function appendIndexedJson(form, key, raw) {
  if (raw === undefined || raw === null || raw === '') return
  let parsed
  try { parsed = JSON.parse(raw) } catch (e) { form.append(`${key}[0]`, String(raw)); return }
  const items = Array.isArray(parsed) ? parsed : [parsed]
  items.forEach((it, i) => form.append(`${key}[${i}]`, typeof it === 'string' ? it : JSON.stringify(it)))
}

module.exports = { preparePdf, finalizePdf }
