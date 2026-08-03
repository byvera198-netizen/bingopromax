import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.bingocontrolpro.ecuador",
  appName: "Bingo Control Pro",
  webDir: "mobile-web",
  server: {
    androidScheme: "https",
    allowNavigation: ["bingo-control-pro-ecuador.eemite.chatgpt.site"],
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
