import { describe, expect, it } from "vitest";
import { describeUserAgent, deviceLabel, timeAgo } from "./sessions";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
};

describe("sesiones: dispositivo y tiempo", () => {
  it("reconoce navegador y sistema", () => {
    expect(deviceLabel(describeUserAgent(UA.chromeWin))).toBe("Chrome en Windows");
    expect(deviceLabel(describeUserAgent(UA.edgeWin))).toBe("Edge en Windows");
    expect(deviceLabel(describeUserAgent(UA.safariIphone))).toBe("Safari en iOS");
    expect(deviceLabel(describeUserAgent(UA.firefoxMac))).toBe("Firefox en macOS");
    expect(deviceLabel(describeUserAgent(UA.chromeAndroid))).toBe("Chrome en Android");
    expect(describeUserAgent(UA.safariIphone).mobile).toBe(true);
    expect(describeUserAgent(UA.chromeWin).mobile).toBe(false);
    expect(deviceLabel(describeUserAgent(null))).toBe("Navegador desconocido");
    expect(deviceLabel(describeUserAgent("curl/8.0"))).toBe("Otro navegador");
  });

  it("tiempo relativo", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    expect(timeAgo("2026-10-18T11:59:40Z", now)).toBe("ahora");
    expect(timeAgo("2026-10-18T11:59:00Z", now)).toBe("hace 1 minuto");
    expect(timeAgo("2026-10-18T11:15:00Z", now)).toBe("hace 45 minutos");
    expect(timeAgo("2026-10-18T09:00:00Z", now)).toBe("hace 3 horas");
    expect(timeAgo("2026-10-16T12:00:00Z", now)).toBe("hace 2 días");
  });
});
