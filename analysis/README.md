# Host analysis

The analysis modules consume only fields exposed by the local HostList API. The database identifier is retained locally and is never sent to the model. Raw profile data, contact details, and location are excluded from the model payload.

Analysis requests happen only after an explicit user action. Model output is validated before it is stored; token usage and estimated costs are recorded locally.
