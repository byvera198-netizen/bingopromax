import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.bingocontrolpro.ecuador",
  appName: "Bingo Control Promax",
  webDir: "mobile-web",
  server: {
    androidScheme: "https",
    allowNavigation: ["bingopromax.pages.dev"],
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
