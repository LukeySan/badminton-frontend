// Runs inside the Playwright Docker container (scripts/test-webkit-docker.sh): makes
// localhost:5173 / 8000 / 8025 in the container reach the app, API and Mailpit on the
// Mac, so the browser and the tests use the same URLs as on the host (and the API's
// CORS origin, http://localhost:5173, still matches).
const net = require("node:net")

const PORTS = [
  [5173, 5174], // the built app, served on the Mac's 127.0.0.1:5174
  [8000, 8000], // API
  [8025, 8025], // Mailpit (password reset emails)
]
for (const [local, remote] of PORTS) {
  net
    .createServer((client) => {
      const upstream = net.connect(remote, "host.docker.internal")
      client.pipe(upstream).pipe(client)
      upstream.on("error", () => client.destroy())
      client.on("error", () => upstream.destroy())
    })
    .listen(local, "127.0.0.1")
}
