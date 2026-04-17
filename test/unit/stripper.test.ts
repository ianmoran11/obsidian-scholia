import { describe, it, expect } from "vitest";
import { stripForTokens } from "../../src/context/stripper";
import { readFileSync } from "fs";
import { join } from "path";

const LONG_NOTE_PATH = join(__dirname, "../fixtures/notes/long-note.md");

describe("context.stripper", () => {
  describe("stripForTokens", () => {
    describe("yaml frontmatter removal", () => {
      it("removes leading YAML frontmatter", () => {
        const input = `---
title: Test
---
Some content`;
        const result = stripForTokens(input);
        expect(result).toBe("Some content");
      });

      it("handles multiline YAML values", () => {
        const input = `---
title: Test
description: >
  This is a multiline
  description
---
Content here`;
        const result = stripForTokens(input);
        expect(result).toBe("Content here");
        expect(result).not.toContain("title");
        expect(result).not.toContain("description");
      });

      it("does nothing if no frontmatter", () => {
        const input = "Just plain content";
        const result = stripForTokens(input);
        expect(result).toBe("Just plain content");
      });
    });

    describe("Obsidian embed removal", () => {
      it("removes wiki-style embeds", () => {
        const input = "Before ![[Embedded Note]] after";
        const result = stripForTokens(input);
        expect(result).toBe("Before  after");
      });

      it("removes multiple embeds", () => {
        const input = "![[First]] text ![[Second]] more ![[Third]]";
        const result = stripForTokens(input);
        expect(result).toBe("text  more");
      });

      it("handles embeds with anchors", () => {
        const input = "![[Note#Section]] content";
        const result = stripForTokens(input);
        expect(result).toBe("content");
      });

      it("handles embeds with aliases", () => {
        const input = "![[Note|Alias]] content";
        const result = stripForTokens(input);
        expect(result).toBe("content");
      });
    });

    describe("image removal", () => {
      it("removes markdown images", () => {
        const input = "Text ![Alt](https://example.com/img.png) more";
        const result = stripForTokens(input);
        expect(result).toBe("Text  more");
      });

      it("removes images with empty alt", () => {
        const input = "![](https://example.com/image.png)";
        const result = stripForTokens(input);
        expect(result).toBe("");
      });

      it("handles multiple images", () => {
        const input = "![img1](url1) text ![img2](url2)";
        const result = stripForTokens(input);
        expect(result).toBe("text");
      });
    });

    describe("http link stripping", () => {
      it("converts markdown links to text for http URLs", () => {
        const input = "Check [this link](https://example.com) out";
        const result = stripForTokens(input);
        expect(result).toBe("Check this link out");
      });

      it("converts http (not https) links too", () => {
        const input = "Visit [Example](http://example.com) now";
        const result = stripForTokens(input);
        expect(result).toBe("Visit Example now");
      });

      it("leaves relative links intact", () => {
        const input = "See [[Local Note]] for details";
        const result = stripForTokens(input);
        expect(result).toBe("See [[Local Note]] for details");
      });

      it("handles multiple http links", () => {
        const input = "[Link1](https://a.com) and [Link2](http://b.com)";
        const result = stripForTokens(input);
        expect(result).toBe("Link1 and Link2");
      });
    });

    describe("blank line collapsing", () => {
      it("collapses triple newlines to double", () => {
        const input = "Para 1\n\n\nPara 2";
        const result = stripForTokens(input);
        expect(result).toBe("Para 1\n\nPara 2");
      });

      it("collapses more than three newlines", () => {
        const input = "A\n\n\n\n\nB";
        const result = stripForTokens(input);
        expect(result).toBe("A\n\nB");
      });

      it("preserves single blank lines", () => {
        const input = "Line 1\n\nLine 2";
        const result = stripForTokens(input);
        expect(result).toBe("Line 1\n\nLine 2");
      });
    });

    describe("combined operation", () => {
      it("handles a realistic markdown document", () => {
        const input = `---
title: Test Document
---

# Heading

Some text with a [link](https://example.com) and an embed ![[Note]].

![image](https://example.com/img.png)

More text here.
`;
        const result = stripForTokens(input);
        expect(result).toBe(`# Heading

Some text with a link and an embed .

More text here.`);
      });

      it("handles code blocks (preserves them)", () => {
        const input = `---
frontmatter: true
---
\`\`\`javascript
const x = 1;
\`\`\`

Text with [link](https://example.com)
`;
        const result = stripForTokens(input);
        expect(result).toContain("const x = 1");
        expect(result).toContain("Text with link");
      });

      it("trims leading and trailing whitespace", () => {
        const input = `---
title: Test
---
Content`;
        const result = stripForTokens(input);
        expect(result).toBe("Content");
        expect(result).not.toMatch(/^\s/);
        expect(result).not.toMatch(/\s$/);
      });
    });

    describe("500-line fixture", () => {
      it("processes the long-note fixture without error", () => {
        const content = readFileSync(LONG_NOTE_PATH, "utf-8");
        const lines = content.split("\n").length;
        expect(lines).toBeGreaterThan(100);

        const result = stripForTokens(content);
        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
        expect(result.length).toBeLessThan(content.length);
      });

      it("removes frontmatter from long fixture", () => {
        const content = readFileSync(LONG_NOTE_PATH, "utf-8");
        const result = stripForTokens(content);
        expect(result).not.toContain("title:");
        expect(result).not.toContain("tags:");
        expect(result).not.toMatch(/^---$/m);
      });

      it("removes embeds from long fixture", () => {
        const content = readFileSync(LONG_NOTE_PATH, "utf-8");
        const result = stripForTokens(content);
        expect(result).not.toContain("![[");
      });

      it("removes images from long fixture", () => {
        const content = readFileSync(LONG_NOTE_PATH, "utf-8");
        const result = stripForTokens(content);
        expect(result).not.toContain("![](");
      });

      it("converts http links to text in long fixture", () => {
        const content = readFileSync(LONG_NOTE_PATH, "utf-8");
        const result = stripForTokens(content);
        expect(result).not.toContain("[Link 1](https://");
        expect(result).toContain("Link 1");
      });

      it("preserves code blocks in long fixture", () => {
        const content = readFileSync(LONG_NOTE_PATH, "utf-8");
        const result = stripForTokens(content);
        expect(result).toContain("function test()");
      });
    });
  });
});
