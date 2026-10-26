import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.tomato.todo',
  appName: '番茄待办',
  webDir: 'dist-mobile',
  android: {
    allowMixedContent: true
  },
  server: {
    androidScheme: 'https'
  }
}

export default config
