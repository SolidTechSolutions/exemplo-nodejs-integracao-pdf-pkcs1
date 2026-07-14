'use strict'
/**
 * [EN]    PAdES (PDF) signing — PKCS#1 two-step flow (Fastify / Node.js 18+).
 *         Setup: npm install && cp .env.example .env  (edit .env)
 *         Run:   npm start
 *         Step 1 — Preparation:  POST http://localhost:3089/api/pdf/sign/preparation
 *         Step 2 — Finalization: POST http://localhost:3089/api/pdf/sign/finalization
 *
 * [PT-BR] Assinatura PAdES (PDF) — fluxo PKCS#1 em dois passos (Fastify / Node.js 18+).
 *         Configurar: npm install && cp .env.example .env  (editar .env)
 *         Executar:   npm start
 */
require('dotenv').config()
const Fastify = require('fastify')
const { preparePdf, finalizePdf } = require('./service')

const fastify = Fastify({ logger: true })
fastify.register(require('@fastify/multipart'))

// ── Step 1: Preparation ───────────────────────────────────────────────────────
fastify.post('/api/pdf/sign/preparation', async (request, reply) => {
  const parts = request.parts()
  const pdfFiles   = []
  const imageFiles = []
  const fields     = {}

  for await (const part of parts) {
    if (part.file) {
      const buf = await part.toBuffer()
      if (part.fieldname.startsWith('signatureImage')) {
        imageFiles.push({ buffer: buf, filename: part.filename })
      } else {
        pdfFiles.push({ buffer: buf, filename: part.filename })
      }
    } else {
      fields[part.fieldname] = part.value
    }
  }

  const result = await preparePdf({
    authorization: fields.authorization,
    baseUrl:       fields.baseUrl,
    files:         pdfFiles,
    imageFiles,
    sigParams:     fields,
  })

  if (!result) return reply.status(500).send({ error: 'Preparation failed. Check logs.' })
  return reply.send(result)
})

// ── Step 2: Finalization ──────────────────────────────────────────────────────
fastify.post('/api/pdf/sign/finalization', async (request, reply) => {
  const parts  = request.parts()
  const fields = {}
  for await (const part of parts) {
    if (!part.file) fields[part.fieldname] = part.value
  }

  let originalFileNames = fields.originalFileNames
  if (typeof originalFileNames === 'string') {
    try { originalFileNames = JSON.parse(originalFileNames) } catch { originalFileNames = originalFileNames.split(',') }
  }

  const zipBuf = await finalizePdf({
    authorization:     fields.authorization,
    baseUrl:           fields.baseUrl,
    signedHashes:      fields.signedHashes,
    finalNonce:        fields.finalNonce,
    originalFileNames: Array.isArray(originalFileNames) ? originalFileNames : [],
  })

  if (!zipBuf) return reply.status(500).send({ error: 'Finalization failed. Check logs.' })
  reply.type('application/zip').header('Content-Disposition', 'attachment; filename="signed_pdf.zip"')
  return zipBuf
})

fastify.listen({ port: Number(process.env.PORT ?? 3089), host: '0.0.0.0' }, err => {
  if (err) { fastify.log.error(err); process.exit(1) }
})
