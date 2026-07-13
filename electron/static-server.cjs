const http = require('http')
const fs = require('fs')
const path = require('path')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
}

function serveStatic(rootDir) {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0])
    if (urlPath === '/') urlPath = '/index.html'

    let filePath = path.join(rootDir, urlPath)

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        if (path.extname(filePath) === '') {
          filePath = path.join(rootDir, urlPath, 'index.html')
          fs.stat(filePath, (err2, stats2) => {
            if (err2 || !stats2.isFile()) {
              serveNotFound(res, rootDir)
            } else {
              streamFile(filePath, res)
            }
          })
          return
        }
        serveNotFound(res, rootDir)
        return
      }
      streamFile(filePath, res)
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port })
    })
  })
}

function serveNotFound(res, rootDir) {
  const fallback = path.join(rootDir, '404.html')
  fs.readFile(fallback, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(data)
    }
  })
}

function streamFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

module.exports = { serveStatic }
