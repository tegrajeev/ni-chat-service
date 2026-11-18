"""Turn the parsed NI schema into an LLM-ready catalog (JSON) and reference doc (Markdown).

Usage: python3 -I build_catalog.py <catalog_raw.json> <out_dir>
"""
import json
import re
import sys
from pathlib import Path

raw = json.load(open(sys.argv[1]))
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

# Tables the chatbot may query. Client/tenant configuration and UI config stay out:
# they are not analytics data and can expose other clients' settings.
EXCLUDED = {
    "ClientDetails": "client/tenant configuration",
    "ClientDataFlagMapping": "client/tenant configuration",
    "ClientNetworkMapping": "client/tenant configuration",
    "ClientSpecialitySourceFlagMapping": "client/tenant configuration",
    "NPIClientFIPSConfig": "client/tenant configuration",
    "LobbyUserConfig": "UI configuration",
    "ExclusiveParentOrgMapping": "client-specific dropdown helper",
}

DESCRIPTIONS = {
    "PlanDetails": "One row per Medicare Advantage plan bid (BidId = contract-plan-segment). Benefits and star rating. Not every BidId in PlanNetworkMapping exists here.",
    "ProviderDetails": "One row per provider NPI (individual practitioners). Names and dual-eligible flag.",
    "Speciality": "Specialty lookup. Use HWAISpecialtyDescription for user-facing specialty names (e.g. 'Cardiology').",
    "LanguageProviderMapping": "Languages a provider speaks.",
    "ProviderScoreDetails": "Provider quality/cost/utilization scores at NPI x FIPS x specialty level (PCP scores are at NPI x FIPS level). Non-numeric scores are stored as -1.",
    "LanguageGeographyMapping": "Population by language spoken in each county, with rank.",
    "ProviderLocation": "Each practice location of a provider. Carries the county (FIPS) and ZIP. NetworkProviderMapping points here, not to the NPI directly.",
    "HospitalDetails": "One row per hospital/facility (HospitalId), with its primary NPI, address and county. Column name is spelled HosptitalName in the design.",
    "ParentOrganization": "Payer parent organizations (e.g. Humana Inc., UnitedHealth Group). The 'competitor' in network comparisons.",
    "HospitalScores": "Hospital attributes and scores: HealthSystem name, Medicare certified beds, ratings, teaching status.",
    "GroupDetails": "Physician groups (GroupTIN = tax ID): name, size, specialty and group-level scores. Temporary table in the design.",
    "State": "State lookup (StateCode, StateName).",
    "Network": "Provider networks (NetworkId) with name, category and carrier.",
    "County": "County lookup by 5-digit FIPS, with StateCode.",
    "EnrollmentDetails": "Plan enrollment by county (BidId x FIPS), plus AEP enrollment growth.",
    "PlanNetworkMapping": "Which network each plan bid uses (BidId -> NetworkId).",
    "NetworkHospitalMapping": "Which hospitals are in each network. Documented as highly accurate.",
    "NetworkProviderMapping": "Which provider locations are in each network, and which parent organization owns the network. Core table for network size and overlap.",
    "ProviderGroupAffiliation": "Provider (NPI) to physician group (GroupTIN), with beneficiary count and a primary-affiliation flag.",
    "ProviderSpecialityMapping": "Provider (NPI) to specialty. A provider can have several rows (SpecialityFlag = Primary / Secondary / Claim).",
    "SpecialityCodeHSDMapping": "CMS network-adequacy (HSD) specialty names per specialty code. A code can map to several HSD names.",
    "ProviderHospitalAffiliation": "Provider (NPI) to hospital (HospitalNPI) with health system and beneficiary count. HospitalNPI is Int here but Varchar in HospitalDetails.",
    "MilesIndividual_10": "Providers (NPI) whose location is within 10 miles of a county (Isochrone_FIPS). Used for access/adequacy.",
    "MilesIndividual_30": "Providers within 30 miles of a county.",
    "MilesIndividual_60": "Providers within 60 miles of a county.",
    "MilesHospital_10": "Hospitals within 10 miles of a county.",
    "MilesHospital_30": "Hospitals within 30 miles of a county.",
    "MilesHospital_60": "Hospitals within 60 miles of a county.",
    "NetworkCountbyFIPS": "Precomputed: number of networks each provider (NPI x specialty) is in, per county.",
    "NetworkCountbyZIP": "Precomputed: number of networks each provider is in, per ZIP.",
    "ProviderAddressCount": "Number of addresses per provider per county.",
    "GeographyPlanFilters": "Plan geography/segmentation: county, plan type, plan category, market, sub-market, footprint, parent organization, contract.",
    "Market": "Market lookup.",
    "SubMarket": "Sub-market lookup.",
    "DataFlagInfo": "Data source lookup for DataFlagCode.",
    "PlanType": "Plan type lookup (HMO, PPO, ...).",
    "PlanGeographyMapping": "Links a plan bid (BidId) to its GeographyPlanFilters row. Use it to get a plan's parent organization, plan type and county.",
    "PlanCategory": "Plan category lookup.",
    "FootPrint": "Footprint lookup.",
    "SpecialitySourceFlagInfo": "Lookup for SpecialitySourceFlagCode (where the specialty came from).",
    "NPIQuickFilterMapping": "Flags whether an NPI x county is Medicare, Medicaid or supply.",
}

FK_ALIASES = {
    "HospitalLocation": "HospitalDetails", "Client": "ClientDetails",
    "SpecialtySourceFlag Info": "SpecialitySourceFlagInfo", "SpecialtySourceFlagInfo": "SpecialitySourceFlagInfo",
}

# Hand-written join paths and pitfalls the model must know.
JOIN_PATHS = [
    ("Providers in a network", "NetworkProviderMapping npm JOIN ProviderLocation pl ON pl.ProviderLocationId = npm.ProviderLocationId JOIN ProviderDetails pd ON pd.NPI = pl.NPI"),
    ("Network owner (competitor)", "NetworkProviderMapping npm JOIN ParentOrganization po ON po.ParentOrganizationId = npm.ParentOrganizationId"),
    ("Provider county / state", "ProviderLocation pl JOIN County c ON c.FIPS = pl.FIPS JOIN State s ON s.StateCode = c.StateCode"),
    ("Provider specialty", "ProviderSpecialityMapping psm JOIN Speciality sp ON sp.SpecialityCode = psm.SpecialityCode  -- add psm.SpecialityFlag = 'Primary' to count each provider once"),
    ("Hospitals in a network", "NetworkHospitalMapping nhm JOIN HospitalDetails hd ON hd.HospitalId = nhm.HospitalId LEFT JOIN HospitalScores hs ON hs.HospitalId = hd.HospitalId"),
    ("Plans using a network", "PlanNetworkMapping pnm JOIN PlanDetails p ON p.BidId = pnm.BidId  -- use LEFT JOIN: not every BidId is in PlanDetails"),
    ("Plan enrollment by county", "EnrollmentDetails ed JOIN PlanNetworkMapping pnm ON pnm.BidId = ed.BidId"),
    ("Plan parent org / plan type / county", "PlanGeographyMapping pgm JOIN GeographyPlanFilters gpf ON gpf.GeographyPlanFiltersId = pgm.GeographyPlanFiltersId JOIN PlanType pt ON pt.PlanTypeId = gpf.PlanTypeId"),
    ("Provider to physician group", "ProviderGroupAffiliation pga JOIN GroupDetails g ON g.GroupTIN = pga.GroupTIN"),
    ("Provider to hospital", "ProviderHospitalAffiliation pha JOIN HospitalDetails hd ON hd.HospitalNPI = CAST(pha.HospitalNPI AS varchar(10))"),
    ("Providers within X miles of a county", "MilesIndividual_30 m WHERE m.Isochrone_FIPS = '<fips>'"),
]
PITFALLS = [
    "Count providers with COUNT(DISTINCT pl.NPI). A provider has several locations and several specialty rows, so COUNT(*) over-counts.",
    "Filter specialty with Speciality.HWAISpecialtyDescription (LIKE '%cardio%'), not by guessing SpecialityCode values.",
    "FIPS, NPI, ZipCode, BidId and GroupTIN are strings (varchar). Quote them: FIPS = '48113'.",
    "Score columns use -1 for 'not available'. Exclude -1 before AVG().",
    "Payer names live in ParentOrganization.ParentOrganizationName (e.g. 'Humana Inc.'). Match with LIKE '%humana%' unless the exact name is known.",
    "County names: County.CountyName may or may not include the word 'County'. Match with LIKE 'Dallas%' together with StateCode.",
    "ProviderHospitalAffiliation.HospitalNPI is Int but HospitalDetails.HospitalNPI is varchar. CAST when joining.",
    "PlanNetworkMapping has BidIds that are missing from PlanDetails. Use LEFT JOIN PlanDetails.",
    "The design lists HospitalDetails.HosptitalName (typo). Use whatever the live schema says; the service sends the live column list.",
]


def resolve_fk(fk_text, tables_by_name):
    if not fk_text:
        return None
    name = re.sub(r"\s+", " ", fk_text).strip(" -")
    name = FK_ALIASES.get(name, name.replace(" ", ""))
    t = tables_by_name.get(name)
    if not t:
        return {"table": name, "column": None}
    pk = next((c["name"] for c in t["columns"] if c["pk"]), None)
    return {"table": name, "column": pk}


# keep the most complete copy of duplicated tables (GroupDetails appears twice)
by_name = {}
for t in raw["tables"]:
    name = t["table"]
    if name not in by_name or len(t["columns"]) > len(by_name[name]["columns"]):
        by_name[name] = t

catalog, excluded = [], []
for name, t in by_name.items():
    if name in EXCLUDED:
        excluded.append({"table": name, "reason": EXCLUDED[name]})
        continue
    cols, notes = [], list(t["notes"])
    for c in t["columns"]:
        if c["type"] is None and (len(c["name"]) > 25 or " " in c["name"]) and name != "NPIQuickFilterMapping":
            notes.append(c["name"])  # a note that sat in the column list
            continue
        col = {"name": c["name"].split(" ")[0], "type": c["type"], "pk": c["pk"]}
        fk = resolve_fk(c["fk"], by_name)
        if fk:
            col["references"] = f'{fk["table"]}.{fk["column"] or col["name"]}'
        if c.get("rawLabel") and " - " in c["rawLabel"]:
            col["note"] = c["rawLabel"].split(" - ", 1)[1]
        elif c.get("rawLabel") and "aka" in c["rawLabel"]:
            col["note"] = c["rawLabel"][c["rawLabel"].index("(") + 1:].rstrip(")")
        cols.append(col)
    catalog.append({
        "table": name, "layer": t["layer"], "description": DESCRIPTIONS.get(name, ""),
        "columns": cols, "notes": notes,
    })

doc = {
    "database": "NI_hackathon_data",
    "schema": "dbo",
    "source": "NI_Table_Schema.xlsx (design document). The service must merge this with the live INFORMATION_SCHEMA; live column names win.",
    "tables": catalog, "joinPaths": [{"name": n, "sql": s} for n, s in JOIN_PATHS],
    "pitfalls": PITFALLS, "excludedTables": excluded,
}
(OUT / "schema_catalog.json").write_text(json.dumps(doc, indent=1))

# ---------- Markdown reference ----------
LAYER_TITLES = {"golden": "Core tables", "golden_mapping": "Mapping tables", "analytical": "Analytical (precomputed) tables",
                "config": "Lookup and plan-geography tables", "usecase_config": "Other"}
lines = [
    "# NI database reference for the chatbot (`NI_hackathon_data.dbo`)",
    "",
    "This file is sent to the LLM as context when it writes SQL, and it is what the chatbot cites as its reference.",
    "It comes from `NI_Table_Schema.xlsx`. The live database schema always wins over this file: the service checks every table and",
    "column against `INFORMATION_SCHEMA` before running a query.",
    "",
    "## How the data fits together",
    "",
    "```",
    "ParentOrganization ─┐",
    "Network ────────────┼── NetworkProviderMapping ── ProviderLocation ── ProviderDetails (NPI)",
    "                    │                                   │                 ├── ProviderSpecialityMapping ── Speciality",
    "                    │                                   └── County ── State├── ProviderGroupAffiliation ── GroupDetails",
    "                    │                                                     └── ProviderHospitalAffiliation",
    "                    ├── NetworkHospitalMapping ── HospitalDetails ── HospitalScores",
    "                    └── PlanNetworkMapping ── PlanDetails (BidId) ── EnrollmentDetails (BidId x FIPS)",
    "                                                     └── PlanGeographyMapping ── GeographyPlanFilters (parent org, plan type, county)",
    "```",
    "",
    "## Join paths",
    "",
]
for n, s in JOIN_PATHS:
    lines += [f"- **{n}:** `{s}`"]
lines += ["", "## Rules and pitfalls", ""] + [f"- {p}" for p in PITFALLS] + [""]
for layer, title in LAYER_TITLES.items():
    group = [t for t in catalog if t["layer"] == layer]
    if not group:
        continue
    lines += [f"## {title}", ""]
    for t in group:
        lines += [f"### {t['table']}", "", t["description"] or "_No description in the design document._", "",
                  "| Column | Type | Key | Note |", "|---|---|---|---|"]
        for c in t["columns"]:
            key = "PK" if c["pk"] else (f"→ {c['references']}" if c.get("references") else "")
            lines.append(f"| {c['name']} | {c['type'] or ''} | {key} | {c.get('note', '')} |")
        for n in t["notes"]:
            lines.append(f"\n> {n}")
        lines.append("")
lines += ["## Not available to the chatbot", ""] + [f"- `{e['table']}`: {e['reason']}" for e in excluded]
(OUT / "SCHEMA_REFERENCE.md").write_text("\n".join(lines) + "\n")
print(f"tables kept: {len(catalog)}, excluded: {len(excluded)}, columns: {sum(len(t['columns']) for t in catalog)}")
print("chars in markdown:", len("\n".join(lines)))
