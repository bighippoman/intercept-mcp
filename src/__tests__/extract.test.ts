import { describe, it, expect } from "vitest";
import { extractFromHtml } from "../extract.js";

const PAGE = `<html><body>
  <h1>Wireless Mouse</h1>
  <span class="price">$24.99</span>
  <ul class="features">
    <li class="feat">Bluetooth</li>
    <li class="feat">Rechargeable</li>
    <li class="feat">Ergonomic</li>
  </ul>
  <a class="buy" href="/cart/add?id=42">Add to cart</a>
  <table id="specs">
    <thead><tr><th>Spec</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Weight</td><td>90g</td></tr>
      <tr><td>DPI</td><td>1600</td></tr>
    </tbody>
  </table>
</body></html>`;

describe("extractFromHtml — selectors", () => {
  it("extracts text from the first match", () => {
    const r = extractFromHtml(PAGE, { title: "h1", price: ".price" });
    expect(r.fields).toEqual({ title: "Wireless Mouse", price: "$24.99" });
  });

  it("extracts an attribute", () => {
    const r = extractFromHtml(PAGE, { buy: { selector: "a.buy", attr: "href" } });
    expect(r.fields!.buy).toBe("/cart/add?id=42");
  });

  it("extracts all matches as an array", () => {
    const r = extractFromHtml(PAGE, { features: { selector: "li.feat", all: true } });
    expect(r.fields!.features).toEqual(["Bluetooth", "Rechargeable", "Ergonomic"]);
  });

  it("returns null for a missing selector and [] for missing all", () => {
    const r = extractFromHtml(PAGE, { nope: ".does-not-exist", many: { selector: ".missing", all: true } });
    expect(r.fields!.nope).toBeNull();
    expect(r.fields!.many).toEqual([]);
  });

  it("collapses whitespace in extracted text", () => {
    const r = extractFromHtml("<p class='x'>  lots\n   of   space </p>", { v: ".x" });
    expect(r.fields!.v).toBe("lots of space");
  });

  it("does not add tables when only selectors are requested", () => {
    const r = extractFromHtml(PAGE, { title: "h1" });
    expect(r.tables).toBeUndefined();
  });

  it("handles an invalid selector without throwing", () => {
    const r = extractFromHtml(PAGE, { bad: ">>>" });
    expect(r.fields!.bad).toBeNull();
  });
});

describe("extractFromHtml — tables", () => {
  it("converts a table with a thead to row objects", () => {
    const r = extractFromHtml(PAGE, undefined, true);
    expect(r.tables).toHaveLength(1);
    expect(r.tables![0]).toEqual([
      { Spec: "Weight", Value: "90g" },
      { Spec: "DPI", Value: "1600" },
    ]);
  });

  it("uses the first row as headers when there is no thead", () => {
    const html = `<table><tr><td>Name</td><td>Age</td></tr><tr><td>Ada</td><td>36</td></tr></table>`;
    const r = extractFromHtml(html, undefined, true);
    expect(r.tables![0]).toEqual([{ Name: "Ada", Age: "36" }]);
  });

  it("extracts multiple tables", () => {
    const html = `
      <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
      <table><tr><th>B</th></tr><tr><td>2</td></tr></table>`;
    const r = extractFromHtml(html, undefined, true);
    expect(r.tables).toHaveLength(2);
    expect(r.tables![0]).toEqual([{ A: "1" }]);
    expect(r.tables![1]).toEqual([{ B: "2" }]);
  });

  it("skips tables with no data rows", () => {
    const html = `<table><thead><tr><th>Only</th><th>Headers</th></tr></thead></table>`;
    const r = extractFromHtml(html, undefined, true);
    expect(r.tables).toEqual([]);
  });

  it("can return both fields and tables together", () => {
    const r = extractFromHtml(PAGE, { title: "h1" }, true);
    expect(r.fields!.title).toBe("Wireless Mouse");
    expect(r.tables).toHaveLength(1);
  });
});
