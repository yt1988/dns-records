import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, DomainError } from "../src/domain.mjs";

test("accepts a domain, a URL, a trailing dot and mixed case", () => {
  assert.equal(normalizeDomain("example.com").name, "example.com");
  assert.equal(normalizeDomain("  Example.COM. ").name, "example.com");
  assert.equal(normalizeDomain("https://www.example.com/a/b?c=1").name, "www.example.com");
  assert.equal(normalizeDomain("example.com/path").name, "example.com");
  assert.equal(normalizeDomain("http://example.com:8080/x").name, "example.com");
});

test("turns an IDN into punycode", () => {
  assert.equal(normalizeDomain("例え.テスト").name, "xn--r8jz45g.xn--zckzah");
  assert.equal(normalizeDomain("https://例え.テスト/").name, "xn--r8jz45g.xn--zckzah");
});

test("rejects IP addresses and things that are not domains", () => {
  for (const ip of ["1.1.1.1", "2606:4700:4700::1111", "[2606:4700:4700::1111]", "https://8.8.8.8/"]) {
    assert.throws(() => normalizeDomain(ip), e => e instanceof DomainError && e.reason === "ip", ip);
  }
  for (const bad of ["", "   ", "localhost", "com", "exa mple.com", "-bad.com", "bad-.com", "a..b.com", "ex*mple.com", "1.2.3.999"]) {
    assert.throws(() => normalizeDomain(bad), DomainError, bad);
  }
});

test("allows underscores in labels (service records) but not a bare trailing TLD", () => {
  assert.equal(normalizeDomain("_dmarc.example.com").name, "_dmarc.example.com");
  assert.throws(() => normalizeDomain("example."), /empty|single/);
});
