"""Upload every video in a folder concurrently and print each decision.

Usage: QUELLIX_API_KEY=qx_live_... python examples/batch_upload.py <rubric_id> <folder>
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from quellix import AsyncQuellix


async def process(
    client: AsyncQuellix, rubric_id: str, path: Path, gate: asyncio.Semaphore
) -> None:
    async with gate:
        video = await client.videos.upload(path, rubric_id=rubric_id, external_id=path.name)
        decided = await client.videos.wait_for_decision(video.id)
    decision = decided.decision
    print(path.name, decided.status.value, decision.decision.value if decision else "-")
    for reason in decision.reasons if decision else []:
        print(f"  - {reason.code}: {reason.message}")


async def main(rubric_id: str, folder: str) -> None:
    gate = asyncio.Semaphore(4)  # at most four videos in flight
    async with AsyncQuellix() as client:  # reads QUELLIX_API_KEY
        suffixes = {".mp4", ".mov", ".webm"}
        files = [p for p in sorted(Path(folder).iterdir()) if p.suffix.lower() in suffixes]
        await asyncio.gather(*(process(client, rubric_id, p, gate) for p in files))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
