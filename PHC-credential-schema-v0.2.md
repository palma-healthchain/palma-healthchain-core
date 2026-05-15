# Palma HealthChain — Canonical Credential Schema v0.2
# github.com/palma-healthchain/palma-schema
# Updated: 2026-05-15
# Changes from v0.1: Added ICVP compliance declaration to PalmaImmunizationCredential

---

## PalmaAllergyCredential — unchanged from v0.1

### Credential type
- W3C type: `VerifiableCredential`, `PalmaAllergyCredential`
- FHIR resource: `AllergyIntolerance`
- Minimum disclosure set: `substanceCode` + `criticality` (must always travel together)

### Layer 0 fields

| Field | Disclosure | Cardinality | FHIR R4 path | Coding |
|---|---|---|---|---|
| allergyId | FIXED | REQ | — | UUID v4 |
| patientDid | FIXED | REQ | — | Palma DID |
| substanceCode | SD | REQ | AllergyIntolerance.code.coding.code | SNOMED CT |
| substanceDisplay | SD | REQ | AllergyIntolerance.code.coding.display | — |
| clinicalStatus | SD | REQ | AllergyIntolerance.clinicalStatus | FHIR ValueSet |
| verificationStatus | SD | REQ | AllergyIntolerance.verificationStatus | FHIR ValueSet |
| type | SD | REQ | AllergyIntolerance.type | FHIR ValueSet |
| category | SD | REQ | AllergyIntolerance.category | FHIR ValueSet |
| criticality | SD | REQ | AllergyIntolerance.criticality | FHIR ValueSet |
| onsetDateTime | SD | OPT | AllergyIntolerance.onsetDateTime | ISO 8601 |
| reactions[].manifestation | SD | OPT | AllergyIntolerance.reaction.manifestation | SNOMED CT |
| reactions[].severity | SD | OPT | AllergyIntolerance.reaction.severity | FHIR ValueSet |
| recorder.did | FIXED | REQ | — | Palma DID |
| recorder.nphiesId | FIXED | OPT | AllergyIntolerance.recorder (extension) | Nphies registry |
| assertedDate | FIXED | REQ | AllergyIntolerance.assertedDate | ISO 8601 |
| lastVerified | FIXED | OPT | — | ISO 8601 |
| note | SD | OPT | AllergyIntolerance.note.text | Plain text |

---

## PalmaImmunizationCredential — v0.2 (adds ICVP compliance declaration)

### Credential type
- W3C type: `VerifiableCredential`, `PalmaImmunizationCredential`
- FHIR resource: `Immunization`
- Minimum disclosure set: `vaccineCode` + `status` + `occurrenceDateTime`
- **NEW v0.2:** ICVP compliance declaration — see below

### IHR ICVP compliance declaration (NEW in v0.2)

The credential type definition in the JSON-LD context includes an explicit
ICVP compliance declaration:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://palma-healthchain.github.io/palma-schema/v0.2/context.json"
  ],
  "type": ["VerifiableCredential", "PalmaImmunizationCredential"],
  "palma:icvpCompliant": true,
  "palma:icvpStandard": "WHO-IHR-2024",
  "palma:gdhcnCompatible": true
}
```

**Rationale:** The WHO IHR 2024 amendments (entered into force 19 September 2025,
applying to 182 States Parties) require global acceptance of digital versions of
the International Certificate of Vaccination or Prophylaxis (ICVP). By declaring
ICVP compliance explicitly in the credential type, Palma Immunization credentials
are legally recognized at borders in all 182 IHR signatory countries without
requiring bilateral agreements.

**Verification:** A verifier confirming ICVP compliance checks:
1. The `palma:icvpCompliant` flag is `true`
2. The `palma:icvpStandard` value is `WHO-IHR-2024`
3. The minimum disclosure set (vaccineCode + status + occurrenceDateTime) is present
4. The issuer DID is registered in the Palma issuer registry
5. The Merkle proof validates against the HealthChain Core anchor

### Layer 0 fields

| Field | Disclosure | Cardinality | FHIR R4 path | Coding | ICVP Required |
|---|---|---|---|---|---|
| immunizationId | FIXED | REQ | — | UUID v4 | — |
| patientDid | FIXED | REQ | — | Palma DID | — |
| vaccineCode | FIXED | REQ | Immunization.vaccineCode | SNOMED CT + CVX | YES |
| vaccineDisplay | FIXED | REQ | Immunization.vaccineCode.display | — | YES |
| status | FIXED | REQ | Immunization.status | FHIR ValueSet | YES |
| occurrenceDateTime | SD | REQ | Immunization.occurrenceDateTime | ISO 8601 | YES |
| lotNumber | SD | OPT | Immunization.lotNumber | Manufacturer | YES (if available) |
| expirationDate | SD | OPT | Immunization.expirationDate | ISO 8601 | — |
| site | SD | OPT | Immunization.site.coding | SNOMED CT | — |
| route | SD | OPT | Immunization.route.coding | SNOMED CT | — |
| doseQuantity | SD | OPT | Immunization.doseQuantity | UCUM | — |
| performer.did | SD | OPT | Immunization.performer.actor (ext) | Palma DID | — |
| manufacturer | SD | OPT | Immunization.manufacturer.display | Free text | YES (if available) |
| protocolApplied.series | SD | OPT | Immunization.protocolApplied.series | — | — |
| protocolApplied.doseNumber | SD | OPT | Immunization.protocolApplied.doseNumber | — | YES |
| protocolApplied.seriesDoses | SD | OPT | Immunization.protocolApplied.seriesDoses | — | — |
| isSubpotent | SD | OPT | Immunization.isSubpotent | Boolean | — |
| recorder.did | FIXED | REQ | — | Palma DID | YES |
| recorder.nphiesId | FIXED | OPT | Immunization.recorder (extension) | Nphies registry | — |
| recorder.country | FIXED | OPT | — | ISO 3166-1 alpha-2 | YES |
| assertedDate | FIXED | REQ | Immunization.assertedDate | ISO 8601 | — |
| note | SD | OPT | Immunization.note.text | Plain text | — |

### New field in v0.2: recorder.country

`recorder.country` (ISO 3166-1 alpha-2 country code) is added to the FIXED
envelope in v0.2. This field is required by the WHO GDHCN for cross-border
certificate recognition — it identifies the country of vaccination.

For Saudi issuers: `recorder.country = "SA"`
For international issuers: the two-letter country code of their jurisdiction.

### WHO GDHCN field mapping

| WHO GDHCN required field | Palma field |
|---|---|
| Vaccine name | vaccineDisplay |
| Vaccine code | vaccineCode (SNOMED CT + CVX) |
| Date administered | occurrenceDateTime |
| Lot number | lotNumber |
| Dose number | protocolApplied.doseNumber |
| Country of vaccination | recorder.country (NEW v0.2) |
| Certificate issuer | recorder.did |
| Certificate ID | immunizationId |

---

## Credential type registry (v0.2)

| Type | Status | Version | Key changes |
|---|---|---|---|
| PalmaAllergyCredential | Designed | v0.1 | No changes |
| PalmaImmunizationCredential | Designed | v0.2 | ICVP compliance, recorder.country |
| PalmaConditionCredential | Queued | — | — |
| PalmaMedicationCredential | Queued | — | — |
| PalmaDiagnosticCredential | Queued | — | — |

---

## Envelope fields (common to all credential types)

All Palma credentials share this W3C VC 2.0 envelope:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://palma-healthchain.github.io/palma-schema/v0.2/context.json"
  ],
  "type": ["VerifiableCredential", "<PalmaCredentialType>"],
  "id": "urn:uuid:<credentialId>",
  "issuer": {
    "id": "did:<method>:<facility>",
    "name": "<institution display name>"
  },
  "validFrom": "<ISO 8601 datetime>",
  "validUntil": "<ISO 8601 datetime or null>",
  "credentialSubject": {
    "id": "<patientDid>",
    "claim": { "<Layer 0 payload>" }
  },
  "credentialStatus": {
    "id": "<Bitstring Status List URL>#<index>",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "<integer>",
    "statusListCredential": "<Bitstring Status List URL>"
  },
  "proof": { "<SD-JWT proof block>" }
}
```

---

## Design invariants (locked)

- credentialSubject is domain-general — no patient-only assumptions
- Zero PHI in any on-chain component
- Minimum disclosure sets are enforced at credential type level
- ES256 signature algorithm
- W3C Bitstring Status List v1.0 for revocation
- OID4VCI for issuance, OID4VP for presentation
- SNOMED CT primary coding + CVX secondary for Immunization
