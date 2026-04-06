import { describe, it, expect, vi, beforeEach } from "vitest";
import { githubHandler } from "../../handlers/github.js";

describe("githubHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and patterns", () => {
    expect(githubHandler.name).toBe("github");
    expect(githubHandler.patterns[0].test("https://github.com/nodejs/node")).toBe(true);
    expect(githubHandler.patterns[0].test("https://github.com/nodejs/node/")).toBe(true);
  });

  it("does not match non-repo URLs", () => {
    expect(githubHandler.patterns[0].test("https://github.com/nodejs/node/blob/main/README.md")).toBe(false);
    expect(githubHandler.patterns[0].test("https://github.com/nodejs/node/issues")).toBe(false);
  });

  it("returns null for non-github URL", async () => {
    const result = await githubHandler.handle("https://example.com");
    expect(result).toBeNull();
  });

  it("fetches README content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("# My Project\n\nA cool project description that is long enough.", { status: 200 })
    );

    const result = await githubHandler.handle("https://github.com/owner/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("owner/repo");
    expect(result!.content).toContain("My Project");
    expect(result!.source).toBe("github");
  });

  it("tries multiple branches on 404", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("# Readme\n\nContent here for the test that is long enough.", { status: 200 }));

    const result = await githubHandler.handle("https://github.com/owner/repo");
    expect(result).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("returns null when all branches fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 })
    );
    const result = await githubHandler.handle("https://github.com/owner/repo");
    expect(result).toBeNull();
  });
});
