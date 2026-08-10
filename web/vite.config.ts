import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const tailnet = mode === 'tailscale'

  if (tailnet) {
    // .env.tailscale is gitignored and holds the tailnet address, which must
    // not be committed. It beats .env in Vite's env precedence, so the only
    // failure mode worth guarding is it being absent — in which case we'd
    // silently serve .env's loopback URL and the phone would point at itself.
    const url = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL ?? ''
    if (!url || /localhost|127\.0\.0\.1/.test(url)) {
      throw new Error(
        'Tailscale mode: VITE_SUPABASE_URL is missing or still loopback. ' +
          'Create web/.env.tailscale with the Tailscale address of the machine ' +
          'running Docker — see web/.env.example.',
      )
    }
  }

  return {
    plugins: [react()],
    server: {
      // Pinned so the app doesn't drift to another port when other Vite
      // dev servers are running; fail loudly instead of auto-incrementing.
      port: 5199,
      strictPort: true,
      // Listen on all interfaces so the tailnet address works. The Windows
      // firewall rule scoped to 100.64.0.0/10 is what keeps this off the
      // local LAN — it has to exist either way, so let it do the enforcing.
      host: tailnet || undefined,
      // Vite rejects Host headers it doesn't recognise; bare IPs are fine but
      // MagicDNS names are not, so allow the tailnet domain.
      allowedHosts: tailnet ? ['.ts.net'] : undefined,
    },
  }
})
