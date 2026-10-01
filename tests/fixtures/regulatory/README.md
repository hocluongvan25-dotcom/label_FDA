# Fixture provenance

`part101-structural.xml` is explicitly **synthetic**. It exercises the documented eCFR DIV1/DIV5/DIV6/DIV8 hierarchy, P/FP/NOTE/table text and paragraph numbering for §§101.3, 101.7, 101.9. Its prose is not a law excerpt and must never be activated for production.

Official documentation and rendered section text were inspected at:
- https://www.ecfr.gov/developers/documentation/api/v1
- https://www.ecfr.gov/api/versioner/v1/full/2025-01-01/title-21.xml?section=101.3
- https://www.ecfr.gov/api/versioner/v1/titles.json
- https://www.federalregister.gov/developers/documentation/api/v1.json

Direct HTTPS eCFR/FederalRegister requests from this sandbox failed during TLS establishment (ECONNRESET); no raw upstream body was available to capture here. **A full live Part 101 XML parser comparison is still a staging requirement.** Do not describe this fixture as a raw government snapshot. Production snapshot hashes are computed from exact fetched decoded HTTP body bytes, never reconstructed text.
