# Tools, discovery and environments

Tools are logical programs. Discovery finds a path using ordered candidates;
the candidate order is priority descending and declaration order as a tie
breaker. A tool launches directly from its discovered path or via another tool.
Tool dependency cycles are invalid. Environments separately describe inherited,
static, active and reserved capture-script providers. Adapter rules may provide
a script path but never an arbitrary shell command.
