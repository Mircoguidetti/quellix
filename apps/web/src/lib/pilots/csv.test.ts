import { describe, expect, it } from "vitest";
import { fileKey, matchFiles, parseCsv, parsePilotCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF, a BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n1,\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["1", ""],
    ]);
    expect(parseCsv('a\n"multi\nline"')).toEqual([["a"], ["multi\nline"]]);
  });
});

describe("parsePilotCsv", () => {
  it("reads rows by header name, in any column order, ignoring extra columns", () => {
    const { rows, problems } = parsePilotCsv(
      "notes,reviewer_decision,external_id,reviewer_minutes,lab_outcome,contributor_ref,source_url\n" +
        "x,Accepted,v_1,2.5,reject,c_1,\n" +
        "y,reject,v_2,,,,https://bucket.example.com/v_2.mp4?sig=abc\n",
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { external_id: "v_1", reviewer_decision: "accept", reviewer_minutes: 2.5, lab_outcome: "reject", contributor_ref: "c_1", source_url: undefined },
      { external_id: "v_2", reviewer_decision: "reject", reviewer_minutes: undefined, lab_outcome: undefined, contributor_ref: undefined, source_url: "https://bucket.example.com/v_2.mp4?sig=abc" },
    ]);
  });

  it("names the line of every problem", () => {
    const { rows, problems } = parsePilotCsv(
      "external_id,reviewer_decision,reviewer_minutes,source_url\n" + "v_1,maybe,2,\n" + ",accept,,\n" + "v_3,accept,-1,\n" + "v_4,accept,,http://insecure.example.com/a.mp4\n" + "v_5,reject,,\n" + "v_5,accept,,\n",
    );
    expect(rows.map((r) => r.external_id)).toEqual(["v_5"]);
    expect(problems).toEqual([
      { line: 2, message: "reviewer_decision must be accept or reject." },
      { line: 3, message: "external_id is required." },
      { line: 4, message: "reviewer_minutes cannot be negative." },
      { line: 5, message: "source_url must start with https://." },
      { line: 7, message: "external_id v_5 is already on line 6." },
    ]);
  });

  it("explains a file that cannot be used", () => {
    expect(parsePilotCsv("").problems[0].message).toBe("The file is empty.");
    expect(parsePilotCsv("id,decision\n1,accept").problems[0].message).toBe("Missing columns: external_id, reviewer_decision.");
    expect(parsePilotCsv("external_id,reviewer_decision\n").problems[0].message).toBe("The file has a header but no rows.");
    const big = `external_id,reviewer_decision\n${Array.from({ length: 2001 }, (_, i) => `v${i},accept`).join("\n")}`;
    expect(parsePilotCsv(big).problems[0].message).toContain("at most 2000");
  });
});

describe("matchFiles", () => {
  const rows = parsePilotCsv("external_id,reviewer_decision\nv_1,accept\nv_2.mp4,reject\nv_3,accept\n").rows;

  it("matches by file name, with or without the extension, ignoring folders", () => {
    const files = [{ name: "batch/v_1.mp4" }, { name: "v_2.mp4" }, { name: "other.mov" }];
    const { matched, unmatchedFiles } = matchFiles(rows, files);
    expect([...matched.entries()].map(([k, f]) => [k, f.name])).toEqual([
      ["v_1", "batch/v_1.mp4"],
      ["v_2.mp4", "v_2.mp4"],
    ]);
    expect(unmatchedFiles).toEqual([{ name: "other.mov" }]);
    expect(fileKey("a/b/clip.final.webm")).toBe("clip.final");
  });
});
