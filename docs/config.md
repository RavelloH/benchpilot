# Configuration

Project discovery walks upwards for `benchpilot.toml`. The local override is `.benchpilot/config.local.toml`; global paths follow the platform conventions and `BENCHPILOT_HOME` creates a portable tree. Objects merge recursively, scalars override, and arrays replace. `config explain` reports the resolved value and source.
