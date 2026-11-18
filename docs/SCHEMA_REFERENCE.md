# NI database reference for the chatbot (`NI_hackathon_data.dbo`)

This file is sent to the LLM as context when it writes SQL, and it is what the chatbot cites as its reference.
It comes from `NI_Table_Schema.xlsx`. The live database schema always wins over this file: the service checks every table and
column against `INFORMATION_SCHEMA` before running a query.

## How the data fits together

```
ParentOrganization ─┐
Network ────────────┼── NetworkProviderMapping ── ProviderLocation ── ProviderDetails (NPI)
                    │                                   │                 ├── ProviderSpecialityMapping ── Speciality
                    │                                   └── County ── State├── ProviderGroupAffiliation ── GroupDetails
                    │                                                     └── ProviderHospitalAffiliation
                    ├── NetworkHospitalMapping ── HospitalDetails ── HospitalScores
                    └── PlanNetworkMapping ── PlanDetails (BidId) ── EnrollmentDetails (BidId x FIPS)
                                                     └── PlanGeographyMapping ── GeographyPlanFilters (parent org, plan type, county)
```

## Join paths

- **Providers in a network:** `NetworkProviderMapping npm JOIN ProviderLocation pl ON pl.ProviderLocationId = npm.ProviderLocationId JOIN ProviderDetails pd ON pd.NPI = pl.NPI`
- **Network owner (competitor):** `NetworkProviderMapping npm JOIN ParentOrganization po ON po.ParentOrganizationId = npm.ParentOrganizationId`
- **Provider county / state:** `ProviderLocation pl JOIN County c ON c.FIPS = pl.FIPS JOIN State s ON s.StateCode = c.StateCode`
- **Provider specialty:** `ProviderSpecialityMapping psm JOIN Speciality sp ON sp.SpecialityCode = psm.SpecialityCode  -- add psm.SpecialityFlag = 'Primary' to count each provider once`
- **Hospitals in a network:** `NetworkHospitalMapping nhm JOIN HospitalDetails hd ON hd.HospitalId = nhm.HospitalId LEFT JOIN HospitalScores hs ON hs.HospitalId = hd.HospitalId`
- **Plans using a network:** `PlanNetworkMapping pnm JOIN PlanDetails p ON p.BidId = pnm.BidId  -- use LEFT JOIN: not every BidId is in PlanDetails`
- **Plan enrollment by county:** `EnrollmentDetails ed JOIN PlanNetworkMapping pnm ON pnm.BidId = ed.BidId`
- **Plan parent org / plan type / county:** `PlanGeographyMapping pgm JOIN GeographyPlanFilters gpf ON gpf.GeographyPlanFiltersId = pgm.GeographyPlanFiltersId JOIN PlanType pt ON pt.PlanTypeId = gpf.PlanTypeId`
- **Provider to physician group:** `ProviderGroupAffiliation pga JOIN GroupDetails g ON g.GroupTIN = pga.GroupTIN`
- **Provider to hospital:** `ProviderHospitalAffiliation pha JOIN HospitalDetails hd ON hd.HospitalNPI = CAST(pha.HospitalNPI AS varchar(10))`
- **Providers within X miles of a county:** `MilesIndividual_30 m WHERE m.Isochrone_FIPS = '<fips>'`

## Rules and pitfalls

- Count providers with COUNT(DISTINCT pl.NPI). A provider has several locations and several specialty rows, so COUNT(*) over-counts.
- Filter specialty with Speciality.HWAISpecialtyDescription (LIKE '%cardio%'), not by guessing SpecialityCode values.
- FIPS, NPI, ZipCode, BidId and GroupTIN are strings (varchar). Quote them: FIPS = '48113'.
- Score columns use -1 for 'not available'. Exclude -1 before AVG().
- Payer names live in ParentOrganization.ParentOrganizationName (e.g. 'Humana Inc.'). Match with LIKE '%humana%' unless the exact name is known.
- County names: County.CountyName may or may not include the word 'County'. Match with LIKE 'Dallas%' together with StateCode.
- ProviderHospitalAffiliation.HospitalNPI is Int but HospitalDetails.HospitalNPI is varchar. CAST when joining.
- PlanNetworkMapping has BidIds that are missing from PlanDetails. Use LEFT JOIN PlanDetails.
- The design lists HospitalDetails.HosptitalName (typo). Use whatever the live schema says; the service sends the live column list.

## Core tables

### PlanDetails

One row per Medicare Advantage plan bid (BidId = contract-plan-segment). Benefits and star rating. Not every BidId in PlanNetworkMapping exists here.

| Column | Type | Key | Note |
|---|---|---|---|
| BidId | Varchar(20) | PK |  |
| PlanName | Varchar(100) |  |  |
| OverAllStarRating | Varchar(25) |  |  |
| MonthlyPremium | Varchar(25) |  |  |
| HealthDeductible | Varchar(100) |  |  |
| MOOP | Varchar(25) |  |  |
| PartBGiveBack | Varchar(25) |  |  |
| StarRatingYear | Varchar(25) |  |  |

> BidIds from Landscape/PlanDetails table are limited , Network and Bid mapping from Ideon might contain additional BidIds, hence no Foreign key at BidId level in PlanNetworkMapping. We can add Networktable Bidids without additional info. in PlanDetails table.

### ProviderDetails

One row per provider NPI (individual practitioners). Names and dual-eligible flag.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | PK |  |
| SecondaryNPI | Varchar(10) |  |  |
| PresentationName | Varchar(100) |  |  |
| FirstName | Varchar(50) |  |  |
| LastName | Varchar(50) |  |  |
| IsDualProvider | Varchar(3) |  |  |

### Speciality

Specialty lookup. Use HWAISpecialtyDescription for user-facing specialty names (e.g. 'Cardiology').

| Column | Type | Key | Note |
|---|---|---|---|
| SpecialityCode | Varchar(5) | PK |  |
| HWAISpecialtyDescription | Varchar(100) |  |  |
| SubSpecialityName | Varchar(100) |  |  |
| NPIType | Varchar(100) |  |  |
| SpecialtyName | Varchar(100) |  |  |

### LanguageProviderMapping

Languages a provider speaks.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| Language | Varchar(50) |  |  |
| LanguageProficiency | Varchar(25) |  |  |

### ProviderScoreDetails

Provider quality/cost/utilization scores at NPI x FIPS x specialty level (PCP scores are at NPI x FIPS level). Non-numeric scores are stored as -1.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| FIPS | Varchar(5) | → County.FIPS |  |
| SpecialityCode | Varchar(5) | → Speciality.SpecialityCode |  |
| QualityScore | Int |  |  |
| MAUtilizationScore | Int |  |  |
| QualityScoreConfidence | Varchar(25) |  |  |
| FFSUtilizationScore | Int |  |  |
| CostScore | Int |  |  |
| CostScoreConfidence | Varchar(25) |  |  |

> These scores are at 2 level, for PCP it is at NPI*FIPS*New_Flag level, while others are at NPI*FIPS*Speciality level. This should be changes from Prod. team and require Speciality values against PCP(even if scores remain same). Informed Aviral

### LanguageGeographyMapping

Population by language spoken in each county, with rank.

| Column | Type | Key | Note |
|---|---|---|---|
| FIPS | Varchar(5) | → County.FIPS |  |
| Language | Varchar(50) |  |  |
| Population | Int |  |  |
| Rank | Int |  |  |

### ProviderLocation

Each practice location of a provider. Carries the county (FIPS) and ZIP. NetworkProviderMapping points here, not to the NPI directly.

| Column | Type | Key | Note |
|---|---|---|---|
| ProviderLocationId | Int | PK |  |
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| AddressFirstLine | Varchar(100) |  |  |
| AddressSecondLine | Varchar(100) |  |  |
| City | Varchar(50) |  |  |
| FIPS | Varchar(5) | → County.FIPS |  |
| ZipCode | Varchar(5) |  |  |
| Latitude | Varchar(25) |  |  |
| Longitude | Varchar(25) |  |  |
| LocationConfidence | Varchar(50) |  | confidence at county level |
| LocationConfidenceAddressLevel | Varchar(50) |  | Confidence at address line |

### HospitalDetails

One row per hospital/facility (HospitalId), with its primary NPI, address and county. Column name is spelled HosptitalName in the design.

| Column | Type | Key | Note |
|---|---|---|---|
| HospitalId | Int | PK |  |
| HospitalNPI | Varchar(10) |  | aka primaryNPI_Id |
| HosptitalName | Varchar(100) |  |  |
| PrimaryNPIName | Varchar(100) |  | can be same as HospitalName |
| StreetAddress | Varchar(100) |  | aka address_first_line |
| City | Varchar(50) |  |  |
| ZipCode | Varchar(5) |  |  |
| FIPS | Varchar(5) | → County.FIPS |  |
| Latitude | Varchar(25) |  |  |
| Longitude | Varchar(25) |  |  |
| SpecialityCode | Varchar(5) | → Speciality.SpecialityCode |  |
| AddressFlag | Varchar(25) |  |  |

> Lat/Lon can be problematic - check and remove with miles

### ParentOrganization

Payer parent organizations (e.g. Humana Inc., UnitedHealth Group). The 'competitor' in network comparisons.

| Column | Type | Key | Note |
|---|---|---|---|
| ParentOrganizationId | Int | PK |  |
| ParentOrganizationName | Varchar(100) |  |  |

### HospitalScores

Hospital attributes and scores: HealthSystem name, Medicare certified beds, ratings, teaching status.

| Column | Type | Key | Note |
|---|---|---|---|
| HospitalId | Int | → HospitalDetails.HospitalId |  |
| HealthSystem | Varchar(100) |  |  |
| MedicareCertifiedBeds | Int |  |  |
| HGIRating | Int |  |  |
| HCAHPSRating | Int |  |  |
| TeachingNonTeaching | Varchar(25) |  |  |
| NPIQualityScore | Int |  |  |
| NPIValueScore | Int |  |  |
| NPIFFSUtilizationScore | Int |  |  |
| NPIMAUtilizationScore | Int |  |  |
| NPICostScore | Int |  |  |
| QualityScoreConfidence | Varchar(25) |  |  |
| FacilityId |  |  |  |

> HospitalScore- NPI*FIPS*Address FirstLine*Speciality

> When we expand to medicaid, score columns will increase, & flag col. for identification

### GroupDetails

Physician groups (GroupTIN = tax ID): name, size, specialty and group-level scores. Temporary table in the design.

| Column | Type | Key | Note |
|---|---|---|---|
| GroupTIN | Varchar(10) | PK | same as OrganizationId? |
| GroupName | Varchar(255) |  |  |
| GroupSize | Int |  |  |
| GroupCostScore | Int |  |  |
| GroupQualityScore | Int |  |  |
| GroupFFSUtilizationScore | Int |  |  |
| GroupMAUtilizationScore | Int |  | TIN*FIPS |
| GroupMAFFSScore | Int |  | No Clarity |
| GroupConfidence | Int |  | TIN*ParentOrg*PlanType |
| GroupSource | Int |  |  |
| GroupNPI | Int |  | list of NPIs, can be in a separate table - TIN*ParentOrg*PlanType |
| GroupSpeciality | Varchar(255) |  |  |
| GroupSpecialityFlag | Varchar(10) |  |  |
| IsMultiSpeciality | Bit |  |  |

> Since Grp-Grp Data is not prepared yet, we are creating a temporary GroupDetails table with only the fields required in NPI search and PNC

### State

State lookup (StateCode, StateName).

| Column | Type | Key | Note |
|---|---|---|---|
| StateCode | Varchar(2) | PK |  |
| StateName | Varchar(50) |  |  |

### Network

Provider networks (NetworkId) with name, category and carrier.

| Column | Type | Key | Note |
|---|---|---|---|
| NetworkId | Int | PK |  |
| NetworkName | Varchar(225) |  |  |
| NetworkCategory | Varchar(100) |  |  |
| Carrier_Name | Varchar(100) |  |  |

### County

County lookup by 5-digit FIPS, with StateCode.

| Column | Type | Key | Note |
|---|---|---|---|
| FIPS | Varchar(5) | PK |  |
| CountyName | Varchar(50) |  |  |
| StateCode | Varchar(2) | → State.StateCode |  |

### EnrollmentDetails

Plan enrollment by county (BidId x FIPS), plus AEP enrollment growth.

| Column | Type | Key | Note |
|---|---|---|---|
| BidId | Varchar(20) | → PlanDetails.BidId |  |
| FIPS | Varchar(5) | → County.FIPS |  |
| Enrollment | Int |  |  |
| AEPEnrollmentGrowth | Int |  |  |

## Mapping tables

### PlanNetworkMapping

Which network each plan bid uses (BidId -> NetworkId).

| Column | Type | Key | Note |
|---|---|---|---|
| BidId | Varchar(20) | → PlanDetails.BidId |  |
| NetworkId | Int | → Network.NetworkId |  |
| ClientId | Int | → ClientDetails.ClientId |  |

### NetworkHospitalMapping

Which hospitals are in each network. Documented as highly accurate.

| Column | Type | Key | Note |
|---|---|---|---|
| HospitalId | Int | → HospitalDetails.HospitalId |  |
| NetworkId | Int | → Network.NetworkId |  |
| DataFlagCode | Int | → DataFlagInfo.DataFlagCode |  |

> The accuracy of this table is extremely high

### NetworkProviderMapping

Which provider locations are in each network, and which parent organization owns the network. Core table for network size and overlap.

| Column | Type | Key | Note |
|---|---|---|---|
| ParentOrganizationId | Int | → ParentOrganization.ParentOrganizationId |  |
| NetworkId | Int | → Network.NetworkId |  |
| ProviderLocationId | Int | → ProviderLocation.ProviderLocationId |  |
| DataFlagCode | Int | → DataFlagInfo.DataFlagCode |  |

### ProviderGroupAffiliation

Provider (NPI) to physician group (GroupTIN), with beneficiary count and a primary-affiliation flag.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| GroupTIN | Varchar(10) | → GroupDetails.GroupTIN |  |
| BeneficiaryCount | Int |  |  |
| PrimaryGroupAffiliation | Bit |  |  |
| IsNI | Bit |  |  |
| Is_NIPlus | Bit |  |  |

### ProviderSpecialityMapping

Provider (NPI) to specialty. A provider can have several rows (SpecialityFlag = Primary / Secondary / Claim).

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| SpecialityCode | Varchar(5) | → Speciality.SpecialityCode |  |
| SpecialityFlag | Varchar(25) |  |  |
| SpecialitySourceFlagCode | Int | → SpecialitySourceFlagInfo.SpecialitySourceFlagCode |  |
| DataFlagCode | Int | → DataFlagInfo.DataFlagCode |  |

> Should we take columns as PrimarySpeciality/ SecondarySpeciality?

### SpecialityCodeHSDMapping

CMS network-adequacy (HSD) specialty names per specialty code. A code can map to several HSD names.

| Column | Type | Key | Note |
|---|---|---|---|
| SpecialityCode | Varchar(5) | → Speciality.SpecialityCode |  |
| HSDSpecialityName | Varchar(100) |  |  |

> This table is used only for Demo Portal. There can be multiple HSDName against 1 Speciality code

### ProviderHospitalAffiliation

Provider (NPI) to hospital (HospitalNPI) with health system and beneficiary count. HospitalNPI is Int here but Varchar in HospitalDetails.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| HospitalNPI | Int |  |  |
| BeneficiaryCount | Int |  |  |
| PrimaryHospitalAffiliation | Bit |  |  |
| HealthSystem | Varchar(100) |  |  |

> Should we map it to HospitalId instead of HospitalNPI?

> V Important to be accurate

> Check HospitalNPI datatype

## Analytical (precomputed) tables

### MilesIndividual_10

Providers (NPI) whose location is within 10 miles of a county (Isochrone_FIPS). Used for access/adequacy.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| NPI_FIPS | Varchar(5) |  |  |
| Isochrone_FIPS | Varchar(5) |  |  |
| SpecialityCode | Varchar(5) | → Speciality.SpecialityCode |  |
| DataFlagCode | Int | → DataFlagInfo.DataFlagCode |  |

### MilesHospital_10

Hospitals within 10 miles of a county.

| Column | Type | Key | Note |
|---|---|---|---|
| HospitalId | Int | → HospitalDetails.HospitalId |  |
| NPI_FIPS | Varchar(5) |  |  |
| Isochrone_FIPS | Varchar(5) |  |  |

### NetworkCountbyFIPS

Precomputed: number of networks each provider (NPI x specialty) is in, per county.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| FIPS | Varchar(5) |  |  |
| SpecialityCode | Varchar(5) |  |  |
| DataFlagCode | Int | → DataFlagInfo.DataFlagCode |  |
| NetworkCount | Int |  |  |

### MilesHospital_30

Hospitals within 30 miles of a county.

| Column | Type | Key | Note |
|---|---|---|---|
| HospitalId | Int | → HospitalDetails.HospitalId |  |
| NPI_FIPS | Varchar(5) |  |  |
| Isochrone_FIPS | Varchar(5) |  |  |

### NetworkCountbyZIP

Precomputed: number of networks each provider is in, per ZIP.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| FIPS | Varchar(5) |  |  |
| ZipCode | Varchar(5) |  |  |
| SpecialityCode | Varchar(5) |  |  |
| DataFlagCode | Int | → DataFlagInfo.DataFlagCode |  |
| NetworkCount | Int |  |  |

### MilesIndividual_30

Providers within 30 miles of a county.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| NPI_FIPS | Varchar(5) |  |  |
| Isochrone_FIPS | Varchar(5) |  |  |
| SpecialityCode | Varchar(5) | → Speciality.SpecialityCode |  |
| DataFlagCode | Int | → DataFlagInfo.DataFlagCode |  |

### MilesHospital_60

Hospitals within 60 miles of a county.

| Column | Type | Key | Note |
|---|---|---|---|
| HospitalId | Int | → HospitalDetails.HospitalId |  |
| NPI_FIPS | Varchar(5) |  |  |
| Isochrone_FIPS | Varchar(5) |  |  |

### MilesIndividual_60

Providers within 60 miles of a county.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| NPI_FIPS | Varchar(5) |  |  |
| Isochrone_FIPS | Varchar(5) |  |  |
| SpecialityCode | Varchar(5) | → Speciality.SpecialityCode |  |
| DataFlagCode | Int | → DataFlagInfo.DataFlagCode |  |

### ProviderAddressCount

Number of addresses per provider per county.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI | Varchar(10) | → ProviderDetails.NPI |  |
| FIPS | Varchar(5) | → County.FIPS |  |
| Complete_Address | Varchar(max) |  |  |
| Addresses_Counts | Int |  |  |

## Lookup and plan-geography tables

### GeographyPlanFilters

Plan geography/segmentation: county, plan type, plan category, market, sub-market, footprint, parent organization, contract.

| Column | Type | Key | Note |
|---|---|---|---|
| GeographyPlanFiltersId | Int | PK |  |
| FIPS | Varchar(5) | → County.FIPS |  |
| PlanTypeId | Int | → PlanType.PlanTypeId |  |
| PlanCategoryId | Int | → PlanCategory.PlanCategoryId |  |
| MarketId | Int | → Market.MarketId |  |
| SubMarketId | Int | → SubMarket.SubMarketId |  |
| FootPrintId | Int | → FootPrint.FootprintId |  |
| ParentOrganizationId | Int | → ParentOrganization.ParentOrganizationId |  |
| ClientId | Int | → ClientDetails.ClientId |  |
| PlanCountyIdentifier | Bit |  |  |
| ContractId | Varchar(10) |  |  |

### Market

Market lookup.

| Column | Type | Key | Note |
|---|---|---|---|
| MarketId | Int | PK |  |
| Market | Varchar(75) |  |  |

### SubMarket

Sub-market lookup.

| Column | Type | Key | Note |
|---|---|---|---|
| SubMarketId | Int | PK |  |
| SubMarket | Varchar(75) |  |  |

### DataFlagInfo

Data source lookup for DataFlagCode.

| Column | Type | Key | Note |
|---|---|---|---|
| DataFlagCode | Int | PK |  |
| DataSource | Varchar(100) |  |  |

> This table is not a part of ETL

### PlanType

Plan type lookup (HMO, PPO, ...).

| Column | Type | Key | Note |
|---|---|---|---|
| PlanTypeId | Int | PK |  |
| PlanType | Varchar(25) |  |  |

### PlanGeographyMapping

Links a plan bid (BidId) to its GeographyPlanFilters row. Use it to get a plan's parent organization, plan type and county.

| Column | Type | Key | Note |
|---|---|---|---|
| GeographyPlanFiltersId | Int | PK |  |
| BidId | Varchar(5) | → County.FIPS |  |

### PlanCategory

Plan category lookup.

| Column | Type | Key | Note |
|---|---|---|---|
| PlanCategoryId | Int | PK |  |
| PlanCategory | Varchar(25) |  |  |

### FootPrint

Footprint lookup.

| Column | Type | Key | Note |
|---|---|---|---|
| FootprintId | Int | PK |  |
| Footprint | Varchar(50) |  |  |

### SpecialitySourceFlagInfo

Lookup for SpecialitySourceFlagCode (where the specialty came from).

| Column | Type | Key | Note |
|---|---|---|---|
| SpecialitySourceFlagCode | Int | PK |  |
| SpecialitySource | Varchar(255) |  |  |

> This table is not a part of ETL

### NPIQuickFilterMapping

Flags whether an NPI x county is Medicare, Medicaid or supply.

| Column | Type | Key | Note |
|---|---|---|---|
| NPI |  |  |  |
| FIPS |  |  |  |
| IsMedicare |  |  |  |
| IsMedicaid |  |  |  |
| IsSupply |  |  |  |

## Not available to the chatbot

- `ClientNetworkMapping`: client/tenant configuration
- `ClientDetails`: client/tenant configuration
- `ExclusiveParentOrgMapping`: client-specific dropdown helper
- `ClientDataFlagMapping`: client/tenant configuration
- `NPIClientFIPSConfig`: client/tenant configuration
- `ClientSpecialitySourceFlagMapping`: client/tenant configuration
- `LobbyUserConfig`: UI configuration
