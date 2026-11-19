# Host analysis input

The local analysis builder creates a compact, source-neutral payload from the saved profile. It omits the local host ID, names of individuals, contact details, raw records, and geographic fields. Empty values are omitted. The profile ID remains local for associating the validated result with its record.

The supported professional fields are `company`, `primary_domain`, `secondary_domains`, `host_experience_years`, `team_size`, `motivation`, `specific_skills`, `offer_extra_info`, and `business_impact`. The demo store accepts only these optional fields in addition to its required record identifier and display fields.

The same builder and prompt are used for deterministic input normalization and model requests. Missing optional fields lower confidence in the available evidence; they do not cause an analysis failure.
