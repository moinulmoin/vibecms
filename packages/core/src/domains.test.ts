import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateSubpathLocation } from "./domains";

const opts = { appHost: "app.vibecms.dev", platformZone: "vibecms.dev" };

describe("validateSubpathLocation", () => {
  it("accepts schemeless and https locations and normalizes case + trailing slash", () => {
    assert.deepEqual(validateSubpathLocation("customer.com/blog", opts), {
      ok: true,
      hostname: "customer.com",
      basePath: "/blog",
    });
    assert.deepEqual(validateSubpathLocation("https://CUSTOMER.com/Blog/", opts), {
      ok: true,
      hostname: "customer.com",
      basePath: "/blog",
    });
    assert.deepEqual(validateSubpathLocation("sub.customer.com/a-b/c2", opts), {
      ok: true,
      hostname: "sub.customer.com",
      basePath: "/a-b/c2",
    });
    // Boundary: 3 segments is the maximum.
    assert.equal(validateSubpathLocation("customer.com/a/b/c", opts).ok, true);
  });

  it("rejects http, query strings, fragments, and root/missing paths", () => {
    assert.equal(validateSubpathLocation("http://customer.com/blog", opts).ok, false);
    assert.equal(validateSubpathLocation("https://customer.com/blog?x=1", opts).ok, false);
    assert.equal(validateSubpathLocation("customer.com/blog#top", opts).ok, false);
    assert.equal(validateSubpathLocation("customer.com", opts).ok, false);
    assert.equal(validateSubpathLocation("customer.com/", opts).ok, false);
    assert.equal(validateSubpathLocation("", opts).ok, false);
  });

  it("rejects more than 3 segments and invalid segment characters", () => {
    assert.equal(validateSubpathLocation("customer.com/a/b/c/d", opts).ok, false);
    assert.equal(validateSubpathLocation("customer.com/blog/", opts).ok, true);
    for (const path of ["/-bad", "/bad seg", "/bad_seg", "//double", "/a//b"]) {
      assert.equal(validateSubpathLocation(`customer.com${path}`, opts).ok, false, path);
    }
  });

  it("rejects the worker's reserved first segments", () => {
    for (const segment of ["_vc", "api", "_astro", "media-assets", "og", "preview"]) {
      const result = validateSubpathLocation(`customer.com/${segment}`, opts);
      assert.equal(result.ok, false, segment);
    }
    // A reserved segment only counts in first position.
    assert.equal(validateSubpathLocation("customer.com/blog/api", opts).ok, true);
  });

  it("does not treat inherited Object properties as reserved segments", () => {
    // Plain-object keyed lookups match Object.prototype members; the reserved
    // set must only contain the worker's own segments.
    assert.equal(validateSubpathLocation("customer.com/constructor", opts).ok, true);
    assert.equal(validateSubpathLocation("customer.com/toString", opts).ok, true);
    assert.equal(validateSubpathLocation("customer.com/valueof", opts).ok, true);
    // "__proto__" is not a valid path segment at all (underscore), so it is
    // rejected by the segment regex — deterministically, not by prototype lookup.
    const proto = validateSubpathLocation("customer.com/__proto__", opts);
    assert.equal(proto.ok, false);
    if (!proto.ok) assert.equal(proto.error, "The path contains invalid characters.");
  });

  it("applies the custom-hostname rules to the host part", () => {
    assert.equal(validateSubpathLocation("vibecms.dev/blog", opts).ok, false);
    assert.equal(validateSubpathLocation("foo.vibecms.dev/blog", opts).ok, false);
    assert.equal(validateSubpathLocation("app.vibecms.dev/blog", opts).ok, false);
    assert.equal(validateSubpathLocation("localhost/blog", opts).ok, false);
    assert.equal(validateSubpathLocation("1.2.3.4/blog", opts).ok, false);
    assert.equal(validateSubpathLocation("customer.com:8443/blog", opts).ok, false);
  });
});
