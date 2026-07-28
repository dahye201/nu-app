import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dadahuis.nu',
  appName: 'nu.',
  webDir: 'www',
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    backgroundColor: '#121212',
  },
  server: {
    iosScheme: 'https',
  },
};

export default config;
