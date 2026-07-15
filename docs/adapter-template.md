# Adapter template

Copy `src/adapters/_template` to `src/adapters/builtin/<adapter-id>`, change the
manifest ID to the directory name, and explicitly declare every catalog
capability. Disabled capabilities require a reason and must mark all platforms
unsupported. The four JSON Schema files define configuration, device, input and
output data; inputs and outputs are referenced by `$defs` names.

The template is intentionally non-executable. It documents the full package
shape without adding a vendor adapter.

Platform overlays may modify tools, discovery, environments, devices, actions,
workflows, parsers and artifacts. They cannot modify the manifest, schemas,
catalog, or capability definitions; platform capability support is declared
only in `capabilities.toml`.
