import { describe, it, expect } from "vitest";
import { blockedUrlReason } from "../url-guard.js";

describe("blockedUrlReason", () => {
  it("allows normal public URLs", () => {
    expect(blockedUrlReason("https://example.com/page")).toBeNull();
    expect(blockedUrlReason("http://news.ycombinator.com")).toBeNull();
    expect(blockedUrlReason("https://8.8.8.8/dns")).toBeNull();
    expect(blockedUrlReason("https://github.com/owner/repo")).toBeNull();
  });

  it("blocks non-http protocols", () => {
    expect(blockedUrlReason("ftp://example.com/file")).toContain("protocol");
    expect(blockedUrlReason("file:///etc/passwd")).toContain("protocol");
  });

  it("blocks localhost and local hostnames", () => {
    expect(blockedUrlReason("http://localhost:3000/admin")).not.toBeNull();
    expect(blockedUrlReason("https://foo.localhost/x")).not.toBeNull();
    expect(blockedUrlReason("https://printer.local")).not.toBeNull();
    expect(blockedUrlReason("https://db.internal/secrets")).not.toBeNull();
    expect(blockedUrlReason("https://nas.home.arpa")).not.toBeNull();
  });

  it("blocks loopback and private IPv4 ranges", () => {
    expect(blockedUrlReason("http://127.0.0.1/")).not.toBeNull();
    expect(blockedUrlReason("https://127.1.2.3:8080/x")).not.toBeNull();
    expect(blockedUrlReason("http://10.0.0.5/")).not.toBeNull();
    expect(blockedUrlReason("http://172.16.0.1/")).not.toBeNull();
    expect(blockedUrlReason("http://172.31.255.255/")).not.toBeNull();
    expect(blockedUrlReason("http://192.168.1.1/router")).not.toBeNull();
    expect(blockedUrlReason("http://100.64.0.1/")).not.toBeNull();
    expect(blockedUrlReason("http://0.0.0.0/")).not.toBeNull();
  });

  it("allows public IPs adjacent to private ranges", () => {
    expect(blockedUrlReason("http://172.15.0.1/")).toBeNull();
    expect(blockedUrlReason("http://172.32.0.1/")).toBeNull();
    expect(blockedUrlReason("http://11.0.0.1/")).toBeNull();
    expect(blockedUrlReason("http://100.63.0.1/")).toBeNull();
  });

  it("blocks the cloud metadata endpoint", () => {
    expect(blockedUrlReason("http://169.254.169.254/latest/meta-data/")).not.toBeNull();
  });

  it("blocks alternate IPv4 notations via WHATWG normalization", () => {
    // new URL("http://2130706433/") normalizes to 127.0.0.1
    expect(blockedUrlReason("http://2130706433/")).not.toBeNull();
    // 0x7f.0.0.1 → 127.0.0.1
    expect(blockedUrlReason("http://0x7f.0.0.1/")).not.toBeNull();
  });

  it("blocks private IPv6 addresses", () => {
    expect(blockedUrlReason("http://[::1]/admin")).not.toBeNull();
    expect(blockedUrlReason("http://[fe80::1]/")).not.toBeNull();
    expect(blockedUrlReason("http://[fc00::1]/")).not.toBeNull();
    expect(blockedUrlReason("http://[fd12:3456::1]/")).not.toBeNull();
    expect(blockedUrlReason("http://[::ffff:192.168.0.1]/")).not.toBeNull();
  });

  it("allows public IPv6 addresses", () => {
    expect(blockedUrlReason("https://[2606:4700:4700::1111]/")).toBeNull();
  });

  it("blocks multicast and reserved ranges", () => {
    expect(blockedUrlReason("http://224.0.0.1/")).not.toBeNull();
    expect(blockedUrlReason("http://255.255.255.255/")).not.toBeNull();
  });
});
