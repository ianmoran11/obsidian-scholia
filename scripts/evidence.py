#!/usr/bin/env python3
"""Generate index.html from evidence directory structure."""

import os
import sys
from pathlib import Path


def generate_index(milestone_dir: Path) -> str:
    milestone_name = milestone_dir.name
    if not milestone_name.startswith("milestone-"):
        return ""
    milestone_num = milestone_name.replace("milestone-", "")

    if not milestone_num.isdigit():
        return ""

    iterations = sorted(
        milestone_dir.glob("iteration-*"),
        key=lambda p: int(p.name.replace("iteration-", "")) if p.name.replace("iteration-", "").isdigit() else 0,
    )

    if not iterations:
        return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Scholia M{milestone_num} evidence</title>
  </head>
  <body>
    <h1>Milestone {milestone_num}</h1>
    <p>No evidence collected yet.</p>
  </body>
</html>"""

    iterations_html = ""
    for it in iterations:
        it_num = it.name.replace("iteration-", "")
        screenshot_before = it / "screenshot-before.png"
        screenshot_after = it / "screenshot-after.png"
        recording = it / "recording.mp4"
        log = it / "log.txt"

        assets = []
        if screenshot_before.exists():
            assets.append(
                f'<a href="{it.name}/screenshot-before.png">before</a>'
            )
        if screenshot_after.exists():
            assets.append(
                f'<a href="{it.name}/screenshot-after.png">after</a>'
            )
        if recording.exists():
            assets.append(f'<a href="{it.name}/recording.mp4">video</a>')
        if log.exists():
            assets.append(f'<a href="{it.name}/log.txt">log</a>')

        assets_str = " | ".join(assets) if assets else "no assets yet"
        iterations_html += f"<li>Iteration {it_num}: {assets_str}</li>\n"

    title = f"Scholia M{milestone_num} evidence"
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
    <style>
      body {{
        font: 14px/1.4 system-ui;
        max-width: 860px;
        margin: 2em auto;
      }}
      video {{
        width: 100%;
      }}
    </style>
  </head>
  <body>
    <h1>Milestone {milestone_num}</h1>
    <ol id="iters">{iterations_html}</ol>
  </body>
</html>"""


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <evidence_dir>", file=sys.stderr)
        sys.exit(1)

    evidence_dir = Path(sys.argv[1])

    if not evidence_dir.exists():
        print(f"Error: {evidence_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    if not evidence_dir.is_dir():
        print(f"Error: {evidence_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    count = 0
    for milestone_dir in sorted(evidence_dir.glob("milestone-*")):
        index_path = milestone_dir / "index.html"
        index_content = generate_index(milestone_dir)
        if index_content:
            index_path.write_text(index_content)
            print(f"Generated: {index_path}")
            count += 1

    print(f"Regenerated {count} milestone index pages")


if __name__ == "__main__":
    main()