import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.bingocontrolpro.ecuador",
  appName: "Bingo ProMax",
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
