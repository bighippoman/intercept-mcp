import { describe, it, expect, vi, beforeEach } from "vitest";
import { githubHandler } from "../../handlers/github.js";

function matches(url: string): boolean {
  return githubHandler.patterns.some((p) => p.test(url));
}

describe("githubHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and matches repo URLs", () => {
    expect(githubHandler.name).toBe("github");
    expect(matches("https://github.com/nodejs/node")).toBe(true);
    expect(matches("https://github.com/nodejs/node/")).toBe(true);
  });

  it("matches blob, issue, pull, and release URLs", () => {
    expect(matches("https://github.com/nodejs/node/blob/main/README.md")).toBe(true);
    expect(matches("https://github.com/nodejs/node/raw/main/lib/fs.js")).toBe(true);
    expect(matches("https://github.com/nodejs/node/issues/123")).toBe(true);
    expect(matches("https://github.com/nodejs/node/pull/456")).toBe(true);
    expect(matches("https://github.com/nodejs/node/releases/tag/v20.0.0")).toBe(true);
    expect(matches("https://github.com/nodejs/node/releases/latest")).toBe(true);
  });

  it("does not match unsupported GitHub URLs", () => {
    expect(matches("https://github.com/nodejs/node/issues")).toBe(false);
    expect(matches("https://github.com/nodejs/node/actions")).toBe(false);
    expect(matches("https://github.com/nodejs/node/wiki/Home")).toBe(false);
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

  it("fetches a blob file and fences code by extension", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("export const x = 1;\n", { status: 200 })
    );

    const result = await githubHandler.handle("https://github.com/owner/repo/blob/main/src/index.ts");
    expect(result).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/owner/repo/main/src/index.ts",
      expect.anything()
    );
    expect(result!.content).toContain("owner/repo/src/index.ts (at main)");
    expect(result!.content).toContain("```typescript");
    expect(result!.content).toContain("export const x = 1;");
  });

  it("returns markdown files without code fencing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("# Docs\n\nSome documentation.", { status: 200 })
    );

    const result = await githubHandler.handle("https://github.com/owner/repo/blob/main/docs/guide.md");
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("```");
    expect(result!.content).toContain("# Docs");
  });

  it("fetches an issue with comments", async () => {
    const issue = {
      title: "Bug: something broke",
      state: "open",
      body: "Steps to reproduce...",
      user: { login: "reporter" },
      created_at: "2026-01-01T00:00:00Z",
      closed_at: null,
      labels: [{ name: "bug" }],
      comments: 1,
    };
    const comments = [
      { user: { login: "maintainer" }, created_at: "2026-01-02T00:00:00Z", body: "Thanks, looking into it." },
    ];

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(issue), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(comments), { status: 200 }));

    const result = await githubHandler.handle("https://github.com/owner/repo/issues/42");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Bug: something broke");
    expect(result!.content).toContain("open");
    expect(result!.content).toContain("@reporter");
    expect(result!.content).toContain("Labels: bug");
    expect(result!.content).toContain("Steps to reproduce");
    expect(result!.content).toContain("@maintainer");
    expect(result!.content).toContain("Thanks, looking into it.");
  });

  it("fetches a pull request with diff stats", async () => {
    const pr = {
      title: "feat: add widget",
      state: "open",
      merged: true,
      body: "Adds the widget.",
      user: { login: "contributor" },
      created_at: "2026-01-01T00:00:00Z",
      closed_at: null,
      labels: [],
      comments: 0,
      base: { ref: "main" },
      head: { ref: "feature/widget" },
      additions: 120,
      deletions: 30,
      changed_files: 5,
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(pr), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const result = await githubHandler.handle("https://github.com/owner/repo/pull/7");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("feat: add widget");
    expect(result!.content).toContain("merged");
    expect(result!.content).toContain("feature/widget → main");
    expect(result!.content).toContain("+120 −30 across 5 files");
  });

  it("fetches a release by tag", async () => {
    const release = {
      tag_name: "v2.0.0",
      name: "Version 2.0",
      body: "## Changes\n- Everything is new",
      published_at: "2026-01-01T00:00:00Z",
      prerelease: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(release), { status: 200 })
    );

    const result = await githubHandler.handle("https://github.com/owner/repo/releases/tag/v2.0.0");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Version 2.0");
    expect(result!.content).toContain("v2.0.0");
    expect(result!.content).toContain("Everything is new");
  });

  it("fetches the latest release", async () => {
    const release = {
      tag_name: "v3.1.0",
      name: null,
      body: "Bug fixes.",
      published_at: "2026-02-01T00:00:00Z",
      prerelease: false,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(release), { status: 200 })
    );

    const result = await githubHandler.handle("https://github.com/owner/repo/releases/latest");
    expect(result).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/releases/latest",
      expect.anything()
    );
    expect(result!.content).toContain("v3.1.0");
  });

  it("returns null when the API call fails (falls back to pipeline)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 403 })
    );
    const result = await githubHandler.handle("https://github.com/owner/repo/issues/1");
    expect(result).toBeNull();
  });

  it("ignores reserved owner names for repo URLs", async () => {
    const result = await githubHandler.handle("https://github.com/settings/profile");
    expect(result).toBeNull();
  });
});
