"""Parse the side-by-side table blocks in NI_Table_Schema.xlsx into a JSON catalog."""
import json, re, sys
import openpyxl

SRC, OUT = sys.argv[1], sys.argv[2]
SHEETS = {
    "Golden Layer Tables": "golden",
    "Golden Layer Mapping Tables": "golden_mapping",
    "Analytical Layer Tables": "analytical",
    "Config Layer Tables": "config",
    "Tables_for _UseCaseMapping": "usecase_config",
}
wb = openpyxl.load_workbook(SRC, data_only=True)
tables = []
for sheet, layer in SHEETS.items():
    ws = wb[sheet]
    grid = {(c.row, c.column): (str(c.value).strip() if c.value is not None else None)
            for row in ws.iter_rows() for c in row}
    maxr, maxc = ws.max_row, ws.max_column
    get = lambda r, c: grid.get((r, c))
    headers = [(r, c) for (r, c), v in grid.items() if v == "Column" and (get(r, c + 1) or "").lower().startswith("data type")]
    for r, c in sorted(headers):
        title = get(r - 1, c)
        if not title:
            continue
        cols, notes = [], []
        rr = r + 1
        while rr <= maxr:
            name = get(rr, c)
            if name is None:
                break
            # next table title starts where the row below is a new header
            if get(rr + 1, c) == "Column" and (get(rr + 1, c + 1) or "").lower().startswith("data type"):
                break
            dtype, cons, idx = get(rr, c + 1), get(rr, c + 2), get(rr, c + 3)
            if dtype is None and cons is None and idx is None and len(name) > 40:
                notes.append(name)  # free-text note under the table
            else:
                raw = name
                clean = re.sub(r"\s*[\(\-].*$", "", name).strip(" []") or name
                fk = re.match(r"FK\s*-?\s*(.+)", cons or "", re.I)
                cols.append({
                    "name": clean, "rawLabel": raw if raw != clean else None,
                    "type": dtype, "pk": bool(cons and cons.upper().startswith("PK")),
                    "fk": fk.group(1).strip() if fk else None, "index": idx,
                })
            rr += 1
        # notes to the right of the block's title row (e.g. ProviderScoreDetails)
        side = get(r - 1, c + 4) if get(r - 1, c + 4) and len(get(r - 1, c + 4) or "") > 40 else None
        if side:
            notes.append(side)
        tables.append({"table": title.split(" ")[0] if " - " not in title else title, "titleRaw": title,
                       "layer": layer, "columns": cols, "notes": notes})
# Gap analysis notes
gap = [str(r[0]).strip() for r in wb["Gap_Analysis"].iter_rows(values_only=True) if r[0]]
json.dump({"tables": tables, "gapAnalysis": gap}, open(OUT, "w"), indent=1)
for t in tables:
    print(f'{t["layer"]:15s} {t["table"]:32s} cols={len(t["columns"]):2d} notes={len(t["notes"])}  ' + ", ".join(c["name"] for c in t["columns"])[:150])
