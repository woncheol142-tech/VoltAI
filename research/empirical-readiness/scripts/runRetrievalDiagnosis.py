#!/usr/bin/env python3
"""Read-only, NUL-aware characterization of the provisional regulation index."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import statistics


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
DATABASE_PATH = WORKSPACE_ROOT / ".volt-ai/kec-regulation-provisional/index.db"
READABILITY_PATH = (
    WORKSPACE_ROOT / ".volt-ai/kec-regulation-provisional/a2-readability.json"
)
COLLECTION_ID = "kec-regulation-provisional"
CLAUSE_PATTERN = re.compile(r"(?<!\d)\d{2,4}(?:\.\d+){1,3}(?!\d)")
QUERIES = ("241.17.3", "접지", "다만")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def nearest_rank(values: list[int], percentile: float) -> int:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(percentile * len(ordered)) - 1)]


def distribution(values: list[int], *, include_p90: bool) -> dict[str, float | int]:
    result: dict[str, float | int] = {
        "min": min(values),
        "max": max(values),
        "median": statistics.median(values),
        "mean": sum(values) / len(values),
    }
    if include_p90:
        result["p90_nearest_rank"] = nearest_rank(values, 0.9)
    return result


def compact(text: str) -> str:
    return " ".join(text.split())


def centered_excerpt(text: str, query: str, limit: int = 40) -> str:
    normalized = compact(text)
    index = normalized.find(query)
    start = 0 if index < 0 else max(0, index - 12)
    return normalized[start : start + limit]


def sample_rowids(total: int) -> list[int]:
    first = [1, 2, 3, 4, 5]
    middle_start = (total - 5) // 2 + 1
    middle = list(range(middle_start, middle_start + 5))
    last = list(range(total - 4, total + 1))
    selected = set(first + middle + last)
    remaining = [rowid for rowid in range(1, total + 1) if rowid not in selected]
    evenly_spaced = [
        remaining[math.floor((rank * (len(remaining) + 1)) / 6) - 1]
        for rank in range(1, 6)
    ]
    return sorted(selected | set(evenly_spaced))


def main() -> None:
    started_at = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(
        timespec="seconds"
    )
    database_sha256_before = sha256(DATABASE_PATH)
    source_page_count = json.loads(READABILITY_PATH.read_text(encoding="utf-8"))[
        "pageCount"
    ]
    database_uri = f"file:{str(DATABASE_PATH).replace(' ', '%20')}?mode=ro&immutable=1"
    connection = sqlite3.connect(database_uri, uri=True)

    try:
        rows = connection.execute(
            "SELECT rowid, page, text FROM kec_chunks "
            "WHERE collection = ? ORDER BY rowid",
            (COLLECTION_ID,),
        ).fetchall()
    finally:
        connection.close()

    page_counts = {page: 0 for page in range(1, source_page_count + 1)}
    for _, page, _ in rows:
        page_counts[page] = page_counts.get(page, 0) + 1

    indexed_page_counts = [count for count in page_counts.values() if count > 0]
    all_page_counts = list(page_counts.values())
    lengths = [len(text) for _, _, text in rows]
    selected_rowids = sample_rowids(len(rows))
    by_rowid = {rowid: (page, text) for rowid, page, text in rows}
    sample = []

    for rowid in selected_rowids:
        page, text = by_rowid[rowid]
        next_row = by_rowid.get(rowid + 1)
        normalized = compact(text)
        sample.append(
            {
                "rowid": rowid,
                "page": page,
                "character_length": len(text),
                "clause_identifier_count": len(CLAUSE_PATTERN.findall(text)),
                "start_excerpt": normalized[:60],
                "end_excerpt": normalized[-60:],
                "next_rowid": rowid + 1 if next_row else None,
                "next_page": next_row[0] if next_row else None,
                "next_start_excerpt": compact(next_row[1])[:60] if next_row else None,
                "starts_at_clause_boundary": "INDETERMINATE",
                "ends_mid_clause": "INDETERMINATE",
            }
        )

    ground_truth = []
    for query in QUERIES:
        matches = [(rowid, page, text) for rowid, page, text in rows if query in text]
        ground_truth.append(
            {
                "query": query,
                "match_count": len(matches),
                "examples": [
                    {
                        "rowid": rowid,
                        "page": page,
                        "excerpt": centered_excerpt(text, query),
                    }
                    for rowid, page, text in matches[:3]
                ],
            }
        )

    database_sha256_after = sha256(DATABASE_PATH)
    if database_sha256_after != database_sha256_before:
        raise RuntimeError("Original database changed during immutable Python analysis")

    output = {
        "started_at": started_at,
        "completed_at": dt.datetime.now(
            dt.timezone(dt.timedelta(hours=9))
        ).isoformat(timespec="seconds"),
        "database_path": str(DATABASE_PATH),
        "database_open_mode": "mode=ro&immutable=1",
        "database_sha256_before": database_sha256_before,
        "database_sha256_after": database_sha256_after,
        "chunk_count": len(rows),
        "source_page_count": source_page_count,
        "indexed_distinct_page_count": len(indexed_page_counts),
        "unindexed_pages": [
            page for page, count in page_counts.items() if count == 0
        ],
        "chunks_per_all_source_page": distribution(
            all_page_counts, include_p90=False
        ),
        "chunks_per_indexed_page": distribution(
            indexed_page_counts, include_p90=False
        ),
        "chunk_character_length": distribution(lengths, include_p90=True),
        "single_page_locator_chunks": sum(
            isinstance(page, int) and page >= 1 for _, page, _ in rows
        ),
        "multi_page_locator_chunks": 0,
        "nul_chunk_count": sum("\x00" in text for _, _, text in rows),
        "total_nul_count": sum(text.count("\x00") for _, _, text in rows),
        "sample_rowids": selected_rowids,
        "sample": sample,
        "sample_clause_identifiers_per_chunk_median": statistics.median(
            item["clause_identifier_count"] for item in sample
        ),
        "ground_truth": ground_truth,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
